require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { classifyIntentWithJev } = require('./jev');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuração de CORS para permitir requisições da extensão Chrome
app.use(cors({
  origin: '*', // Permite origens de extensões (chrome-extension://...)
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Rota de verificação de saúde do servidor
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    hasApiKey: Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim()),
    model: process.env.OPENROUTER_MODEL || 'typesafe/jev-latest'
  });
});

// Rota principal: Classificação de Decisão com o Jev via OpenRouter
app.post('/api/decide', async (req, res) => {
  const { prompt, context } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({
      error: 'O campo "prompt" é obrigatório e deve ser uma string com o comando falado.'
    });
  }

  console.log(`\n[OpenRouter / Jev Request] Prompt: "${prompt}"`);

  try {
    const decision = await classifyIntentWithJev(prompt, context);
    console.log(`[Decisão] Ação: ${decision.action} (${decision.label}) | Confiança: ${(decision.confidence * 100).toFixed(1)}% | Latência: ${decision.latency}ms`);
    return res.json(decision);
  } catch (err) {
    console.error('[Server Error]', err);
    return res.status(500).json({
      error: 'Falha interna ao processar decisão.',
      details: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log('====================================================');
  console.log(`🚀 Servidor Jev Voice ativo na porta ${PORT}`);
  console.log(`🔗 Endpoint de decisão: http://localhost:${PORT}/api/decide`);
  console.log(`🌐 Provedor: OpenRouter API (${process.env.OPENROUTER_MODEL || 'typesafe/jev-latest'})`);
  console.log(`🔑 Status da Chave: ${process.env.OPENROUTER_API_KEY ? 'Configurada' : 'Aguardando chave em .env (modo calibrado ativo)'}`);
  console.log('====================================================');
});
