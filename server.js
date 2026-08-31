require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const app = express();


const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN,
});

app.use(cors());
app.use(express.json());

app.post('/api/criar-preferencia', async (req, res) => {
  try {
    const { items, payer, backUrls, autoReturn } = req.body;

  
    const preference = new Preference(client);

    const body = {
      items: items.map(item => ({
        id: item.id,
        title: item.title,
        description: item.description,
        quantity: item.quantity || 1,
        unit_price: item.unitPrice,
        currency_id: item.currencyId || 'BRL'
      })),
      payer: payer || {},
      back_urls: backUrls || {},
      auto_return: autoReturn || 'approved',
      statement_descriptor: 'FRETESMT',
      notification_url: `http://10.0.0.142:3000/api/notificacao-pagamento`
    };

    const response = await preference.create({ body });

    res.status(200).json({
      success: true,
      initPoint: response.init_point,
      preferenceId: response.id
    });

  } catch (error) {
    console.error('Erro ao criar preferência:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


app.post('/api/notificacao-pagamento', async (req, res) => {
  try {
    const { id, topic } = req.body;
    
    console.log('📩 Webhook recebido:', { id, topic });

    if (topic === 'payment') {
      const payment = new Payment(client);
      const response = await payment.get({ id });
      
      console.log('💳 Status do pagamento:', response.status);

      if (response.status === 'approved') {
        console.log('✅ Pagamento APROVADO!');
        console.log('📦 Detalhes:', response);
        // 🔥 Aqui você atualiza o Firestore
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Erro no webhook:', error);
    res.status(500).send('Error');
  }
});


app.get('/api/status-pagamento/:preferenceId', async (req, res) => {
  try {
    const { preferenceId } = req.params;
    
    res.status(200).json({
      success: true,
      status: 'pending',
      preferenceId: preferenceId
    });
  } catch (error) {
    console.error('Erro ao consultar status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


app.get('/', (req, res) => {
  res.json({
    message: '🚀 API FretesMT funcionando!',
    version: '1.0.0',
    endpoints: {
      criarPreferencia: 'POST /api/criar-preferencia',
      notificacao: 'POST /api/notificacao-pagamento',
      status: 'GET /api/status-pagamento/:preferenceId'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📡 URL: http://10.0.0.142:${PORT}`);
});