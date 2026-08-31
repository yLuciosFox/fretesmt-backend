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

// 🔥 ROTA RAIZ PARA TESTE
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

// 🔥 ROTA PARA CRIAR PREFERÊNCIA
app.post('/api/criar-preferencia', async (req, res) => {
  try {
    const { items, payer, backUrls, autoReturn } = req.body;

    console.log('📥 Criando preferência para:', items);

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
      // 🔥 CORRIGIDO: URL do Render
      notification_url: `https://fretesmt-backend.onrender.com/api/notificacao-pagamento`
    };

    const response = await preference.create({ body });

    console.log('✅ Preferência criada:', response.id);

    res.status(200).json({
      success: true,
      initPoint: response.init_point,
      preferenceId: response.id
    });

  } catch (error) {
    console.error('❌ Erro ao criar preferência:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 🔥 WEBHOOK PARA NOTIFICAÇÕES
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

// 🔥 ROTA PARA CONSULTAR STATUS
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  // 🔥 CORRIGIDO: URL do Render
  console.log(`📡 URL: https://fretesmt-backend.onrender.com`);
});