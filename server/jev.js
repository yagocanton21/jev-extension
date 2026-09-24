/**
 * Módulo de Decisão JEV (TypeSafe AI) via OpenRouter Decisions API
 * Modelo: typesafe/jev-1.13
 * Endpoint: https://openrouter.ai/api/alpha/decisions
 */

const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/alpha/decisions';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'typesafe/jev-1.13';

// Critérios para a primitiva 'Choice' do modelo JEV
const ACTION_CRITERIA = {
  'clicar elemento': 'quando o comando se refere a clicar, abrir ou selecionar um vídeo, resultado, link, botão ou elemento visível na tela atual',
  'pesquisar': 'quando o usuário quer buscar, procurar ou pesquisar um assunto, vídeo, produto ou informação',
  'abrir site': 'quando o usuário quer abrir um site externo ou domínio específico (ex: youtube, uol, github, mercadolivre)',
  'rolar para baixo': 'quando o usuário quer rolar a página para baixo ou descer a tela',
  'rolar para cima': 'quando o usuário quer rolar a página para cima ou subir a tela',
  'nova aba': 'quando o usuário quer criar ou abrir uma nova aba vazia',
  'fechar aba': 'quando o usuário quer fechar a aba atual',
  'voltar': 'quando o usuário quer voltar para a página anterior no histórico',
  'avancar': 'quando o usuário quer avançar para a próxima página no histórico',
  'atualizar': 'quando o usuário quer recarregar ou atualizar a página atual'
};

/**
 * Consulta a API do JEV para tomada de decisão estruturada com probabilidades calibradas
 */
async function classifyIntentWithJev(prompt, context = {}) {
  const startTime = Date.now();

  const stateDescription = [
    `Comando do usuário: "${prompt}"`,
    context.url ? `URL da página atual: ${context.url}` : '',
    context.title ? `Título da página: ${context.title}` : ''
  ].filter(Boolean).join('\n');

  const requestBody = {
    model: OPENROUTER_MODEL,
    state: stateDescription,
    questions: {
      action: {
        type: 'choice',
        instructions: 'Qual ação de navegação o usuário deseja executar no navegador?',
        criteria: ACTION_CRITERIA
      },
      is_sensitive: {
        type: 'noul',
        instructions: 'Essa ação envolve risco, pagamentos, compras, alteração de senhas ou exclusão de dados/contas?'
      }
    }
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'http://localhost:3001',
        'X-Title': 'Jev Voice Assistant',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`JEV API retornou status ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const latency = Date.now() - startTime;

    return mapJevAnswerToExtensionAction(data, prompt, context, latency);
  } catch (err) {
    console.error('[Jev Decision Error]', err.message);
    throw err;
  }
}

/**
 * Converte a decisão probabilística do JEV no contrato executado pela extensão
 */
function mapJevAnswerToExtensionAction(jevData, prompt, context, latency) {
  const actionAnswer = jevData.answers?.action || {};
  const isSensitiveAnswer = jevData.answers?.is_sensitive || {};

  const choice = actionAnswer.choice || 'pesquisar';
  const confidence = typeof actionAnswer.confidence === 'number' ? actionAnswer.confidence : 0.95;
  const probabilities = actionAnswer.probabilities || { [choice]: confidence };
  const isSensitive = (isSensitiveAnswer.noul || 0) > 0.65;

  let action = 'UNKNOWN';
  let label = choice;
  let params = {};

  switch (choice) {
    case 'clicar elemento': {
      action = 'CLICK_ELEMENT';
      const cleanTarget = prompt
        .replace(/^(?:abrir|abra|abre|clicar em|clique em|clicar no|clique no|selecionar|tocar)\s+(?:o|a|ao)?\s*/i, '')
        .trim();
      label = `clicar em "${cleanTarget || prompt}"`;
      params = { target: cleanTarget || prompt };
      break;
    }

    case 'pesquisar': {
      const cleanQuery = prompt
        .replace(/^(?:pesquis[ae]|procur[ae]|busqu[ae]|pesquisar)\s+(?:por\s+)?/i, '')
        .replace(/\s+no google$/i, '')
        .trim() || prompt;

      const isExplicitGoogle = prompt.toLowerCase().includes('no google');
      const isYouTube = context.url && context.url.includes('youtube.com');
      const isMercadoLivre = context.url && context.url.includes('mercadolivre.com');

      if (!isExplicitGoogle && (isYouTube || isMercadoLivre)) {
        action = 'SEARCH_ON_PAGE';
        label = `pesquisar "${cleanQuery}" na página`;
      } else {
        action = 'SEARCH_GOOGLE';
        label = `pesquisar "${cleanQuery}" no Google`;
      }
      params = { query: cleanQuery };
      break;
    }

    case 'abrir site': {
      action = 'OPEN_URL';
      const siteName = prompt
        .replace(/^(?:abrir|abra|abre|acessar|acesse|ir para|vai para)\s+(?:o|a|ao)?\s*/i, '')
        .trim();
      label = `abrir ${siteName}`;

      const siteMap = {
        'youtube': 'https://www.youtube.com',
        'mercado livre': 'https://www.mercadolivre.com.br',
        'gmail': 'https://mail.google.com',
        'google': 'https://www.google.com',
        'amazon': 'https://www.amazon.com.br',
        'github': 'https://github.com',
        'uol': 'https://www.uol.com.br'
      };

      const targetUrl = siteMap[siteName.toLowerCase()] || (
        siteName.includes('.') ? (siteName.startsWith('http') ? siteName : `https://${siteName}`) : `https://www.${siteName.replace(/\s+/g, '')}.com.br`
      );

      params = { url: targetUrl };
      break;
    }

    case 'rolar para baixo':
      action = 'SCROLL_DOWN';
      label = 'rolar para baixo';
      break;

    case 'rolar para cima':
      action = 'SCROLL_UP';
      label = 'rolar para cima';
      break;

    case 'nova aba':
      action = 'NEW_TAB';
      label = 'abrir nova aba';
      break;

    case 'fechar aba':
      action = 'CLOSE_TAB';
      label = 'fechar aba';
      break;

    case 'voltar':
      action = 'BACK';
      label = 'voltar página';
      break;

    case 'avancar':
      action = 'FORWARD';
      label = 'avançar página';
      break;

    case 'atualizar':
      action = 'RELOAD';
      label = 'atualizar página';
      break;

    default:
      action = 'SEARCH_GOOGLE';
      label = `pesquisar "${prompt}"`;
      params = { query: prompt };
  }

  return {
    action,
    label,
    confidence,
    probabilities,
    is_sensitive: isSensitive,
    params,
    model: jevData.model || OPENROUTER_MODEL,
    latency,
    cost: typeof jevData.usage?.cost === 'number' ? jevData.usage.cost : 0.000018
  };
}

module.exports = {
  classifyIntentWithJev,
  ACTION_CRITERIA
};
