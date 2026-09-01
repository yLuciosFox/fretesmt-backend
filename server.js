require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

// 🔥 FIREBASE ADMIN
const admin = require('firebase-admin');

// 🔥 Verifica se a variável de ambiente existe
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('❌ ERRO: FIREBASE_SERVICE_ACCOUNT não configurada!');
  console.error('💡 Adicione a variável de ambiente no Render com o conteúdo do serviceAccountKey.json');
  process.exit(1);
}

// 🔥 Converte a string JSON para objeto
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  console.log('✅ Firebase Service Account carregada com sucesso!');
} catch (error) {
  console.error('❌ Erro ao parsear FIREBASE_SERVICE_ACCOUNT:', error.message);
  process.exit(1);
}

// 🔥 Inicializa o Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const app = express();

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN,
});

app.use(cors());
app.use(express.json());

// 🔥 ROTA RAIZ
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

// 🔥 CRIAR PREFERÊNCIA
app.post('/api/criar-preferencia', async (req, res) => {
  try {
    const { items, payer, autoReturn } = req.body;

    console.log('📥 Criando preferência para:', items);
    console.log('👤 Payer recebido:', payer);

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
      payer: {
        name: payer?.name || 'Usuário',
        email: payer?.email || 'usuario@email.com',
        metadata: {
          firebase_uid: payer?.uid || ''
        }
      },
      back_urls: {
        success: `fretesmt://pagamento/sucesso?planoId=${items[0]?.id?.replace('plano_', '') || ''}`,
        failure: 'fretesmt://pagamento/erro',
        pending: 'fretesmt://pagamento/pendente'
      },
      auto_return: autoReturn || 'approved',
      statement_descriptor: 'FRETESMT',
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

// 🔥 FUNÇÃO PARA ATUALIZAR O FIRESTORE POR UID
async function atualizarPlanosPorUid(uid, quantidade) {
  try {
    console.log(`🔍 Buscando usuário com UID: ${uid}`);
    
    const userRef = db.collection('usuarios').doc(uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.log(`❌ Usuário com UID ${uid} não encontrado`);
      return false;
    }
    
    const userData = userDoc.data();
    const planosAtuais = userData.planosAdquiridos || 0;
    const novosPlanos = planosAtuais + quantidade;
    
    console.log(`📊 Planos atuais: ${planosAtuais} → +${quantidade} = ${novosPlanos}`);
    
    await userRef.update({
      planosAdquiridos: novosPlanos,
      ultimaCompra: Date.now()
    });
    
    console.log(`✅ Firestore atualizado para UID: ${uid}`);
    console.log(`✅ Novos planos: ${novosPlanos}`);
    
    return true;
    
  } catch (error) {
    console.error('❌ Erro ao atualizar Firestore:', error);
    return false;
  }
}

// 🔥 WEBHOOK - VERSÃO DEFINITIVA
app.post('/api/notificacao-pagamento', async (req, res) => {
  try {
    // 🔥 LER O CORPO DA REQUISIÇÃO CORRETAMENTE
    const body = req.body;
    
    // 🔥 SE NÃO TIVER CORPO, RETORNA
    if (!body || Object.keys(body).length === 0) {
      console.log('📩 Webhook recebido sem corpo');
      return res.status(200).send('OK');
    }

    console.log('📩 Webhook recebido:', JSON.stringify(body, null, 2));

    // 🔥 EXTRAIR O ID DO PAGAMENTO DE DIFERENTES LUGARES
    let paymentId = null;
    
    // 🔥 PRIORIDADE 1: data.id (notificações de payment)
    if (body.data && body.data.id) {
      paymentId = body.data.id;
      console.log(`✅ ID do pagamento (data.id): ${paymentId}`);
    }
    
    // 🔥 PRIORIDADE 2: resource numérico
    if (!paymentId && body.resource && body.resource.match(/^\d+$/)) {
      paymentId = body.resource;
      console.log(`✅ ID do pagamento (resource): ${paymentId}`);
    }
    
    // 🔥 PRIORIDADE 3: id direto
    if (!paymentId && body.id && body.id.toString().match(/^\d+$/)) {
      paymentId = body.id.toString();
      console.log(`✅ ID do pagamento (id): ${paymentId}`);
    }

    // 🔥 SE NÃO TEM ID, RETORNA
    if (!paymentId) {
      console.log('⏳ Nenhum ID de pagamento encontrado');
      return res.status(200).send('OK');
    }

    // 🔥 BUSCAR O PAGAMENTO
    console.log(`🔍 Buscando pagamento ${paymentId}...`);
    
    try {
      const payment = new Payment(client);
      const response = await payment.get({ id: paymentId });
      
      console.log(`💳 Status: ${response.status}`);

      if (response.status === 'approved') {
        console.log('✅✅✅ PAGAMENTO APROVADO! ✅✅✅');
        
        // 🔥 EXTRAI O UID DO METADATA
        const firebaseUid = response.payer?.metadata?.firebase_uid || null;
        const payerEmail = response.payer?.email || null;
        const amount = response.transaction_amount || 0;
        
        console.log(`👤 Firebase UID: ${firebaseUid}`);
        console.log(`👤 Email: ${payerEmail}`);
        console.log(`💰 Valor: R$ ${amount}`);
        console.log(`🆔 ID: ${paymentId}`);
        
        // 🔥 DETERMINAR QUANTIDADE
        let quantidade = 1;
        if (amount === 15.99) quantidade = 1;
        else if (amount === 25.99) quantidade = 2;
        else if (amount === 35.99) quantidade = 3;
        else if (amount === 65.99) quantidade = 6;
        else if (amount === 75.99) quantidade = 7;
        
        console.log(`📦 Quantidade de anúncios: ${quantidade}`);
        
        // 🔥 ATUALIZAR POR UID
        let atualizado = false;
        
        if (firebaseUid) {
          console.log(`✅ UID encontrado no metadata: ${firebaseUid}`);
          atualizado = await atualizarPlanosPorUid(firebaseUid, quantidade);
        } else {
          console.log('⚠️ Nenhum UID encontrado no metadata do pagamento');
        }
        
        // 🔥 FALLBACK: tenta por email
        if (!atualizado && payerEmail) {
          console.log(`🔄 Fallback: tentando buscar usuário pelo email: ${payerEmail}`);
          
          const usersRef = db.collection('usuarios');
          const snapshot = await usersRef.where('email', '==', payerEmail).get();
          
          if (!snapshot.empty) {
            const userDoc = snapshot.docs[0];
            const uid = userDoc.id;
            console.log(`✅ Usuário encontrado pelo email! UID: ${uid}`);
            atualizado = await atualizarPlanosPorUid(uid, quantidade);
          } else {
            console.log(`❌ Nenhum usuário encontrado com o email: ${payerEmail}`);
          }
        }
        
        if (atualizado) {
          console.log('🎉 Firestore atualizado com sucesso!');
        } else {
          console.log('❌ NÃO FOI POSSÍVEL ATUALIZAR O FIRESTORE');
        }
        
        return res.status(200).json({
          success: true,
          message: 'Pagamento aprovado!',
          paymentId: paymentId,
          quantidade: quantidade,
          firestoreAtualizado: atualizado
        });
        
      } else {
        console.log(`⏳ Status: ${response.status}`);
        return res.status(200).send('OK');
      }
      
    } catch (error) {
      console.error('❌ Erro ao buscar pagamento:', error.message);
      return res.status(200).send('OK');
    }

  } catch (error) {
    console.error('❌ Erro no webhook:', error);
    res.status(200).send('OK');
  }
});

// 🔥 CONSULTAR STATUS
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
  console.log(`📡 URL: https://fretesmt-backend.onrender.com`);
});