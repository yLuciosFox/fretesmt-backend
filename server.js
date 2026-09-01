require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

// 🔥 FIREBASE ADMIN
const admin = require('firebase-admin');

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('❌ ERRO: FIREBASE_SERVICE_ACCOUNT não configurada!');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  console.log('✅ Firebase Service Account carregada com sucesso!');
} catch (error) {
  console.error('❌ Erro ao parsear FIREBASE_SERVICE_ACCOUNT:', error.message);
  process.exit(1);
}

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

// 🔥 CRIAR PREFERÊNCIA (COM SALVAMENTO DO UID)
app.post('/api/criar-preferencia', async (req, res) => {
  try {
    const { items, payer, autoReturn, backUrls } = req.body;

    console.log('📥 Criando preferência para:', items);
    console.log('👤 Payer recebido:', payer);

    // 🔥 BUSCAR O UID NO FIRESTORE PELO EMAIL
    let firebaseUid = null;
    if (payer && payer.email) {
      try {
        const usersRef = db.collection('usuarios');
        const snapshot = await usersRef.where('email', '==', payer.email).get();
        
        if (!snapshot.empty) {
          const userDoc = snapshot.docs[0];
          firebaseUid = userDoc.id;
          console.log(`✅ UID encontrado no Firestore para ${payer.email}: ${firebaseUid}`);
        } else {
          console.log(`❌ Usuário com email ${payer.email} não encontrado`);
        }
      } catch (error) {
        console.error('❌ Erro ao buscar usuário:', error.message);
      }
    }

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
          firebase_uid: firebaseUid || ''
        }
      },
      back_urls: backUrls || {
        success: `fretesmt://pagamento/sucesso?planoId=${items[0]?.id?.replace('plano_', '') || ''}`,
        failure: 'fretesmt://pagamento/erro',
        pending: 'fretesmt://pagamento/pendente'
      },
      auto_return: autoReturn || 'approved',
      statement_descriptor: 'FRETESMT',
      notification_url: `https://fretesmt-backend.onrender.com/api/notificacao-pagamento`
    };

    console.log('📦 Body enviado:', JSON.stringify(body, null, 2));

    const response = await preference.create({ body });

    console.log('✅ Preferência criada:', response.id);

    // 🔥 🔥 🔥 SALVAR O UID NO FIRESTORE COM O PREFERENCE_ID
    if (firebaseUid) {
      try {
        await db.collection('preferencias').doc(response.id).set({
          uid: firebaseUid,
          email: payer?.email || '',
          createdAt: Date.now()
        });
        console.log(`✅ UID ${firebaseUid} salvo com preference_id: ${response.id}`);
      } catch (saveError) {
        console.error('❌ Erro ao salvar referência:', saveError.message);
      }
    }

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
      console.log(`❌ Usuário com UID ${uid} NÃO encontrado no Firestore`);
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
    
    console.log(`✅ Firestore ATUALIZADO para UID: ${uid}`);
    console.log(`✅ Novos planos: ${novosPlanos}`);
    
    return true;
    
  } catch (error) {
    console.error('❌ Erro ao atualizar Firestore:', error);
    return false;
  }
}

// 🔥 WEBHOOK - VERSÃO SIMPLES E DEFINITIVA
app.post('/api/notificacao-pagamento', async (req, res) => {
  try {
    const body = req.body;
    
    if (!body || Object.keys(body).length === 0) {
      console.log('📩 Webhook recebido sem corpo');
      return res.status(200).send('OK');
    }

    console.log('📩 Webhook recebido:', JSON.stringify(body, null, 2));

    if (body.topic === 'merchant_order') {
      console.log('📦 Merchant_order ignorado');
      return res.status(200).send('OK');
    }

    let paymentId = null;
    
    if (body.data && body.data.id) {
      paymentId = body.data.id;
      console.log(`✅ ID do pagamento (data.id): ${paymentId}`);
    }
    
    if (!paymentId && body.resource && body.resource.match(/^\d+$/)) {
      paymentId = body.resource;
      console.log(`✅ ID do pagamento (resource): ${paymentId}`);
    }

    if (!paymentId) {
      console.log('⏳ Nenhum ID de pagamento encontrado');
      return res.status(200).send('OK');
    }

    console.log(`🔍 Buscando pagamento ${paymentId}...`);
    
    try {
      const payment = new Payment(client);
      const response = await payment.get({ id: paymentId });
      
      console.log(`💳 Status: ${response.status}`);

      if (response.status === 'approved') {
        console.log('✅✅✅ PAGAMENTO APROVADO! ✅✅✅');
        
        const amount = response.transaction_amount || 0;
        
        // 🔥 DETERMINAR QUANTIDADE
        let quantidade = 1;
        if (amount === 15.99) quantidade = 1;
        else if (amount === 25.99) quantidade = 2;
        else if (amount === 35.99) quantidade = 3;
        else if (amount === 65.99) quantidade = 6;
        else if (amount === 75.99) quantidade = 7;
        
        console.log(`💰 Valor: R$ ${amount}`);
        console.log(`📦 Quantidade de anúncios: ${quantidade}`);
        
        // 🔥 🔥 🔥 BUSCAR O UID NO FIRESTORE PELO PREFERENCE_ID
        let uid = null;
        const preferenceId = response.preference_id;
        
        if (preferenceId) {
          try {
            console.log(`🔍 Buscando UID no Firestore com preference_id: ${preferenceId}`);
            const prefDoc = await db.collection('preferencias').doc(preferenceId).get();
            
            if (prefDoc.exists) {
              uid = prefDoc.data().uid;
              console.log(`✅ UID encontrado: ${uid}`);
            } else {
              console.log(`⚠️ preference_id ${preferenceId} não encontrado no Firestore`);
            }
          } catch (error) {
            console.log('⚠️ Erro ao buscar referência:', error.message);
          }
        } else {
          console.log('⚠️ Nenhum preference_id encontrado na resposta');
        }
        
        // 🔥 ATUALIZAR O FIRESTORE
        if (uid) {
          console.log(`🎯 Atualizando Firestore para UID: ${uid}`);
          const atualizado = await atualizarPlanosPorUid(uid, quantidade);
          console.log(`✅ Firestore atualizado: ${atualizado}`);
        } else {
          console.log('❌ NENHUM UID ENCONTRADO!');
        }
        
        // 🔥 LIMPAR A REFERÊNCIA (opcional)
        if (preferenceId) {
          try {
            await db.collection('preferencias').doc(preferenceId).delete();
            console.log(`🗑️ Referência ${preferenceId} removida`);
          } catch (e) {}
        }
        
        return res.status(200).json({
          success: true,
          message: 'Pagamento aprovado!',
          paymentId: paymentId,
          quantidade: quantidade,
          uidEncontrado: uid || null
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