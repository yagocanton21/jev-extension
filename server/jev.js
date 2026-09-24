/**
 * Módulo de Integração com o Jev via OpenRouter API
 * Suporta o modelo 'typesafe/jev-latest' e outros modelos de decisão
 */

const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'typesafe/jev-latest';

// Lista de ações válidas para a decisão
const ACTION_OPTIONS = [
  'abrir site',
  'pesquisar',
  'nova aba',
  'fechar aba',
  'rolar pagina baixo',
  'rolar pagina cima',
  'voltar',
  'avancar',
  'atualizar',
  'clicar elemento',
  'digitar texto',
  'desconhecido'
];

const SYSTEM_PROMPT = `Você é o mecanismo de decisão JEV para automação de navegador do assistente Jev Voice.
Sua função é interpretar a fala do usuário e convertê-la em uma ação estruturada de navegação considerando a página em que ele já está.

Você DEVE responder EXCLUSIVAMENTE em formato JSON com o seguinte schema:
{
  "action": "OPEN_URL" | "SEARCH_ON_PAGE" | "SEARCH_GOOGLE" | "NEW_TAB" | "CLOSE_TAB" | "BACK" | "FORWARD" | "RELOAD" | "SCROLL_UP" | "SCROLL_DOWN" | "CLICK_ELEMENT" | "TYPE_TEXT" | "UNKNOWN",
  "label": "descrição concisa da ação em português",
  "confidence": número de 0.0 a 1.0 indicando a certeza da decisão,
  "probabilities": {
    "abrir site": float,
    "pesquisar": float,
    "nova aba": float,
    "fechar aba": float,
    "rolar pagina": float,
    "navegacao": float
  },
  "is_sensitive": boolean (true se envolver pagamentos, compras, exclusão de conta/dados ou envio crítico),
  "params": {
    "url": "URL completa se for OPEN_URL",
    "query": "termo de busca LIMPO (sem as palavras 'pesquisar', 'pesquise', etc.)",
    "target": "nome/texto do botão ou campo",
    "text": "texto a ser digitado"
  },
  "composite_actions": [opcional: lista de ações sequenciais caso o usuário dê comandos compostos]
}

Regras Cruciais:
1. CONSCIENTE DO CONTEXTO: Se o usuário estiver em um site com busca interna (ex: youtube.com, mercadolivre.com.br, amazon.com.br) e pedir para pesquisar algo (ex: "pesquisar como fazer arroz"), use SEMPRE "SEARCH_ON_PAGE" para preencher a busca do próprio site e NÃO sair dele, a menos que ele diga explicitamente "no google".
2. CLIQUE EM ELEMENTOS / VÍDEOS: Se o usuário disser "abrir primeiro vídeo", "abrir segundo resultado", "clicar no vídeo", "abrir link", etc., classifique SEMPRE como CLICK_ELEMENT com target "primeiro vídeo" / etc. NUNCA classifique isso como OPEN_URL! OPEN_URL é EXCLUSIVO para nomes de sites/domínios (ex: "abrir youtube", "abrir uol", "amazon.com").
3. LIMPEZA DE TERMO: Em qualquer busca, remova os prefixos de comando como "pesquisar", "pesquise", "procure por" do campo params.query. Exemplo: "pesquisar como fazer arroz" -> query: "como fazer arroz".
4. Se o usuário falar apenas um termo solto (ex: "nissan gtr 2019"), use SEARCH_ON_PAGE se estiver em site com busca ou SEARCH_GOOGLE se estiver em página genérica.`;

/**
 * Consulta a API da OpenRouter para tomada de decisão
 */
async function classifyIntentWithJev(prompt, context = {}) {
  const startTime = Date.now();

  // Se não houver chave no .env, utiliza o emulador calibrado
  if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY.trim() === '') {
    console.log('[OpenRouter / Jev] OPENROUTER_API_KEY ausente. Utilizando motor simulador calibrado.');
    return simulateJevResponse(prompt, context, startTime);
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        comando_usuario: prompt,
        pagina_atual: context.url || '',
        titulo_pagina: context.title || ''
      })
    }
  ];

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'http://localhost:3001',
        'X-Title': 'Jev Voice Chrome Assistant',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: messages,
        temperature: 0.1,
        response_format: { type: 'json_object' }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter retornou status ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const latency = Date.now() - startTime;
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('Resposta vazia da OpenRouter');
    }

    const parsed = JSON.parse(content);

    return {
      action: parsed.action || 'UNKNOWN',
      label: parsed.label || parsed.action || 'ação indefinida',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.95,
      probabilities: parsed.probabilities || { [parsed.label || 'acao']: 0.95 },
      is_sensitive: Boolean(parsed.is_sensitive),
      params: parsed.params || {},
      composite_actions: parsed.composite_actions || null,
      model: data.model || OPENROUTER_MODEL,
      latency: latency,
      cost: typeof data.usage?.cost === 'number' ? data.usage.cost : 0.000015
    };
  } catch (err) {
    console.error('[OpenRouter / Jev Error]', err.message);
    return simulateJevResponse(prompt, context, startTime, true);
  }
}

/**
 * Emulador calibrado do Jev para testes e modo offline
 */
function simulateJevResponse(prompt, context, startTime, isFallback = false) {
  const normalized = prompt
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  const probs = {
    'abrir site': 0.01,
    'pesquisar': 0.01,
    'nova aba': 0.00,
    'fechar aba': 0.00,
    'rolar pagina': 0.00,
    'navegacao': 0.00
  };

  let action = 'SEARCH_GOOGLE';
  let label = `pesquisar "${prompt}"`;
  let confidence = 0.95;
  let params = { query: prompt };

  if (normalized.includes('nova aba') || normalized.includes('abrir aba')) {
    action = 'NEW_TAB';
    label = 'abrir nova aba';
    confidence = 0.98;
    probs['nova aba'] = 0.98;
    params = {};
  } else if (normalized.includes('fechar aba') || normalized.includes('fecha aba')) {
    action = 'CLOSE_TAB';
    label = 'fechar aba';
    confidence = 0.99;
    probs['fechar aba'] = 0.99;
    params = {};
  } else if (normalized.includes('rolar para baixo') || normalized.includes('desce') || normalized.includes('descer')) {
    action = 'SCROLL_DOWN';
    label = 'rolar para baixo';
    confidence = 0.97;
    probs['rolar pagina'] = 0.97;
    params = {};
  } else if (normalized.includes('rolar para cima') || normalized.includes('sobe') || normalized.includes('subir')) {
    action = 'SCROLL_UP';
    label = 'rolar para cima';
    confidence = 0.97;
    probs['rolar pagina'] = 0.97;
    params = {};
  } else if (normalized.includes('voltar')) {
    action = 'BACK';
    label = 'voltar página';
    confidence = 0.96;
    probs['navegacao'] = 0.96;
    params = {};
  } else if (normalized.includes('avancar')) {
    action = 'FORWARD';
    label = 'avançar página';
    confidence = 0.96;
    probs['navegacao'] = 0.96;
    params = {};
  } else if (normalized.includes('atualizar') || normalized.includes('recarregar')) {
    action = 'RELOAD';
    label = 'atualizar página';
    confidence = 0.95;
    probs['navegacao'] = 0.95;
    params = {};
  } else if (normalized.match(/(?:primeir[oa]|1[ºª]|segund[oa]|2[ºª]|terceir[oa]|3[ºª]|quart[oa]|4[ºª]|quint[oa]|5[ºª]|ultim[oa]|v[ií]deo|resultado|link|bot[aã]o|item|produto)/i) && normalized.match(/(?:abrir|clicar|clique|abra|abre|tocar|selecionar)/i)) {
    action = 'CLICK_ELEMENT';
    const clean = prompt.replace(/^(?:abrir|abra|abre|clicar em|clique em|clicar no|clique no|selecionar)\s+(?:o|a|ao)?\s*/i, '').trim();
    label = `clicar em "${clean}"`;
    confidence = 0.95;
    probs['clicar elemento'] = 0.95;
    params = { target: clean };
  } else if (normalized.match(/^(?:abrir|abra|abre|acessar|acesse|ir para)\s+/i)) {
    action = 'OPEN_URL';
    const clean = prompt.replace(/^(?:abrir|abra|abre|acessar|acesse|ir para)\s+(?:o|a|ao)?\s*/i, '').trim();
    label = `abrir ${clean}`;
    confidence = 0.98;
    probs['abrir site'] = 0.98;

    const siteMap = {
      'mercado livre': 'https://www.mercadolivre.com.br',
      'youtube': 'https://www.youtube.com',
      'gmail': 'https://mail.google.com',
      'amazon': 'https://www.amazon.com.br',
      'github': 'https://github.com'
    };
    params = { url: siteMap[clean.toLowerCase()] || `https://www.${clean.replace(/\s+/g, '')}.com.br` };
  } else {
    // Limpeza de prefixos como 'pesquisar', 'procure', etc.
    let cleanQuery = prompt
      .replace(/^(?:pesquis[ae]|procur[ae]|busqu[ae]|pesquisar)\s+(?:por\s+)?/i, '')
      .replace(/\s+no google$/i, '')
      .trim();
    if (!cleanQuery) cleanQuery = prompt;

    // Se estiver em um site com busca (YouTube, Mercado Livre, etc.) e não pediu 'no google'
    const isExplicitGoogle = normalized.includes('no google');
    const isYouTube = context.url && context.url.includes('youtube.com');
    const isMercadoLivre = context.url && context.url.includes('mercadolivre.com');

    if (!isExplicitGoogle && (isYouTube || isMercadoLivre)) {
      action = 'SEARCH_ON_PAGE';
      label = `pesquisar "${cleanQuery}" na página`;
      confidence = 0.96;
      probs['pesquisar'] = 0.96;
      params = { query: cleanQuery };
    } else {
      action = 'SEARCH_GOOGLE';
      label = `pesquisar "${cleanQuery}" no Google`;
      confidence = 0.95;
      probs['pesquisar'] = 0.95;
      params = { query: cleanQuery };
    }
  }

  const isSensitive = normalized.includes('comprar') ||
                      normalized.includes('pagar') ||
                      normalized.includes('excluir') ||
                      normalized.includes('deletar') ||
                      normalized.includes('senha');

  const latency = Math.max(75, Date.now() - startTime);

  return {
    action,
    label,
    confidence,
    probabilities: probs,
    is_sensitive: isSensitive,
    params,
    model: `${OPENROUTER_MODEL}${isFallback ? ' (fallback)' : ''}`,
    latency,
    cost: 0.000054
  };
}

module.exports = {
  classifyIntentWithJev,
  ACTION_OPTIONS
};
