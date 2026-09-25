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
  'clicar elemento': 'quando o comando se refere a clicar, abrir, entrar em ou selecionar um link, resultado de busca, vídeo, botão ou elemento interativo na página atual (ex: "clicar login", "abrir primeiro link", "entrar no resultado", "abrir segundo vídeo", "clicar no canal")',
  'pesquisar': 'quando o usuário quer buscar ou pesquisar um assunto, vídeo, produto ou informação (ex: "pesquisar receitas", "buscar notebook")',
  'abrir site': 'quando o usuário quer navegar digitando um endereço direto ou citando um portal famoso externo (ex: "abrir youtube", "ir para github", "acessar uol.com.br", "abrir mercadolivre")',
  'alternar aba': 'quando o usuário quer mudar, alternar ou voltar para uma aba/janela que já está aberta com um site específico',
  'rolar para baixo': 'quando o usuário quer rolar a página para baixo ou descer a tela',
  'rolar para cima': 'quando o usuário quer rolar a página para cima ou subir a tela',
  'nova aba': 'quando o usuário quer criar ou abrir uma nova aba vazia',
  'fechar aba': 'quando o usuário quer fechar a aba atual do navegador',
  'voltar': 'quando o usuário quer voltar para a página anterior no histórico, sair do vídeo atual, fechar o vídeo ou retornar ao feed',
  'avancar': 'quando o usuário quer avançar para a próxima página no histórico',
  'atualizar': 'quando o usuário quer recarregar ou atualizar a página atual',
  'reproduzir video': 'quando o usuário quer dar play, reproduzir, tocar, continuar ou despausar o vídeo',
  'pausar video': 'quando o usuário quer pausar ou parar a reprodução do vídeo',
  'controlar audio': 'quando o usuário quer mutar, desmutar ou silenciar o áudio do vídeo',
  'tela cheia': 'quando o usuário quer colocar ou tirar o vídeo de tela cheia'
};

/**
 * Consulta a API do JEV para tomada de decisão estruturada com probabilidades calibradas
 */
async function classifyIntentWithJev(prompt, context = {}) {
  const startTime = Date.now();

  const stateDescription = [
    `Comando do usuário: "${prompt}"`,
    context.url ? `URL da página atual: ${context.url}` : '',
    context.title ? `Título da página: ${context.title}` : '',
    context.pageType ? `Tipo de página: ${context.pageType}` : '',
    context.hasVideo ? `Possui reprodutor de vídeo: Sim` : '',
    context.hasSearchInput ? `Possui campo de busca interno: Sim` : '',
    context.visibleOptions ? `Opções visíveis na tela: ${context.visibleOptions}` : ''
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
  let confidence = typeof actionAnswer.confidence === 'number' ? actionAnswer.confidence : 0.95;
  let probabilities = actionAnswer.probabilities || { [choice]: confidence };
  const isSensitive = (isSensitiveAnswer.noul || 0) > 0.65;

  let action = 'UNKNOWN';
  let label = choice;
  let params = {};

  const trimmed = prompt.trim();
  const isDirectOpenVerb = /^(?:abrir|abra|abre|clicar|clique|selecionar|tocar|entrar|acessar)\b/i.test(trimmed);
  const isExternalSite = /^(?:abrir|abra|abre|acessar|acesse|ir para|vai para)\s+(?:o|a|ao)?\s*(youtube|mercado livre|mercadolivre|google|gmail|github|uol|amazon|maps|google maps|chat\s*gpt|chat\s*pt|whatsapp|instagram|twitter|reddit|wikipedia|globo|g1|netflix|spotify|linkedin|facebook)/i.test(trimmed);

  // Se o usuário falou expressamente "Abrir [vídeo/anúncio/título/link]" e NÃO é um site externo famoso,
  // prioriza "clicar elemento" (evita que o modelo caia em "pesquisar" ou "abrir site" sintetizando URLs falsas)
  let effectiveChoice = choice;
  if (isExternalSite) {
    effectiveChoice = 'abrir site';
  } else if (isDirectOpenVerb && (choice === 'pesquisar' || choice === 'abrir site')) {
    // Se o comando não tiver um domínio explícito (ex: ".com") e não for site famoso,
    // significa que é para clicar no elemento/link da página
    const hasDomain = /\.(?:com|org|net|io|ai|gov|edu|me|app|tv|br)\b/i.test(trimmed);
    if (!hasDomain) {
      effectiveChoice = 'clicar elemento';
    }
  }

  // Interceptadores diretos para troca de guias/abas
  if (/pr[oó]xima\s+(?:aba|guia)|(?:aba|guia)\s+seguinte/i.test(trimmed)) {
    effectiveChoice = 'proxima aba';
    confidence = 1.0;
    probabilities = { 'proxima aba': 1.0 };
  } else if (/(?:aba|guia)\s+anterior/i.test(trimmed)) {
    effectiveChoice = 'aba anterior';
    confidence = 1.0;
    probabilities = { 'aba anterior': 1.0 };
  } else if (/^(?:volt[ae]r?|retorn[ae]r?|sair)(?:\s+(?:uma\s+)?p[aá]gina)?(?:\s+(?:antes|atr[aá]s|anterior))?$|^(?:p[aá]gina\s+(?:anterior|antes))$/i.test(trimmed)) {
    effectiveChoice = 'voltar';
    confidence = 1.0;
    probabilities = { 'voltar': 1.0 };
  } else if (/^(?:dar\s+)?play(?:\s+no\s+v[ií]deo)?$|^(?:tocar|iniciar|reproduzir|despausar|continuar)(?:\s+o)?(?:\s+v[ií]deo)?$/i.test(trimmed) || /^play$/i.test(trimmed)) {
    effectiveChoice = 'reproduzir video';
    confidence = 1.0;
    probabilities = { 'reproduzir video': 1.0 };
  } else if (/^(?:pausar|pause|parar)(?:\s+o)?(?:\s+v[ií]deo)?$/i.test(trimmed) || /^(?:pause|pausa)$/i.test(trimmed)) {
    effectiveChoice = 'pausar video';
    confidence = 1.0;
    probabilities = { 'pausar video': 1.0 };
  } else if (/^(?:mutar|silenciar|tirar\s+o?\s*som|desmutar)(?:\s+o)?(?:\s+v[ií]deo)?$/i.test(trimmed) || /^(?:mudo|mutar)$/i.test(trimmed)) {
    effectiveChoice = 'controlar audio';
    confidence = 1.0;
    probabilities = { 'controlar audio': 1.0 };
  } else if (/^(?:tela\s+cheia|maximizar|sair\s+da\s+tela\s+cheia)(?:\s+o)?(?:\s+v[ií]deo)?$/i.test(trimmed) || /^tela\s+cheia$/i.test(trimmed)) {
    effectiveChoice = 'tela cheia';
    confidence = 1.0;
    probabilities = { 'tela cheia': 1.0 };
  }

  switch (effectiveChoice) {
    case 'clicar elemento': {
      if (/^(?:fechar|sair\s+do|feche)\s+v[ií]deo$/i.test(prompt.trim())) {
        action = 'BACK';
        label = 'fechar vídeo (voltar)';
        params = {};
        break;
      }
      action = 'CLICK_ELEMENT';
      // Limpa verbos de ação e preposições iniciais para isolar o alvo real
      const cleanTarget = prompt
        .replace(/^(?:abrir|abra|abre|clicar|clique|cliquei|selecionar|selecione|tocar|toque|entrar|entre|acessar|acesse)\s+(?:em|no|na|nos|nas|o|a|os|as|ao|aos|do|da|dos|das|de|pelo|pela|num|numa)?\s*/i, '')
        .replace(/(?:\s+no\s+youtube|\s+no\s+google|\s+na\s+p[aá]gina)$/i, '')
        .trim();
      label = `clicar em "${cleanTarget || prompt}"`;
      params = { target: cleanTarget || prompt };
      break;
    }

    case 'pesquisar': {
      let cleanQuery = prompt
        .replace(/^(?:pesquis[ae]|procur[ae]|busqu[ae]|pesquisar)\s+(?:por\s+)?/i, '')
        .replace(/\s+no google$/i, '')
        .trim();
      cleanQuery = cleanQuery.replace(/^(?:abrir|clicar)\s+/i, '').trim() || prompt;

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
      const siteName = prompt
        .replace(/^(?:abrir|abra|abre|acessar|acesse|ir para|vai para|entrar no|entrar na)\s+(?:o|a|ao)?\s*/i, '')
        .trim();

      const siteMap = {
        'youtube': 'https://www.youtube.com',
        'mercadolivre': 'https://www.mercadolivre.com.br',
        'mercado livre': 'https://www.mercadolivre.com.br',
        'gmail': 'https://mail.google.com',
        'google': 'https://www.google.com',
        'amazon': 'https://www.amazon.com.br',
        'github': 'https://github.com',
        'uol': 'https://www.uol.com.br',
        'globo': 'https://www.globo.com',
        'g1': 'https://g1.globo.com',
        'chatgpt': 'https://chatgpt.com',
        'chatpt': 'https://chatgpt.com',
        'openai': 'https://openai.com',
        'whatsapp': 'https://web.whatsapp.com',
        'instagram': 'https://www.instagram.com',
        'twitter': 'https://x.com',
        'x': 'https://x.com',
        'reddit': 'https://www.reddit.com',
        'netflix': 'https://www.netflix.com',
        'spotify': 'https://open.spotify.com',
        'wikipedia': 'https://pt.wikipedia.org'
      };

      const cleanSiteKey = siteName.toLowerCase().replace(/\s+/g, '');
      const hasExplicitDomain = siteName.includes('.') && !siteName.endsWith('.');

      if (siteMap[cleanSiteKey] || hasExplicitDomain) {
        action = 'OPEN_URL';
        const targetUrl = siteMap[cleanSiteKey] || (
          siteName.startsWith('http') ? siteName : `https://${siteName}`
        );
        label = `abrir ${siteName}`;
        params = { url: targetUrl };
      } else {
        // Se NÃO é um site famoso mapeado e NÃO tem extensão de domínio (.com, .org, etc.),
        // NUNCA sintetiza uma URL falsa como www.nomedosite.com.br!
        // Se estiver em uma página de resultados ou tiver contexto de página, clica no elemento correspondente
        const isSearchOrContentPage = context.url && (context.url.includes('google.') || context.url.includes('bing.') || context.url.includes('youtube.com'));
        if (isSearchOrContentPage) {
          action = 'CLICK_ELEMENT';
          label = `clicar em "${siteName}"`;
          params = { target: siteName };
        } else {
          // Caso contrário, faz pesquisa no Google pelo termo
          action = 'SEARCH_GOOGLE';
          label = `pesquisar "${siteName}" no Google`;
          params = { query: siteName };
        }
      }
      break;
    }

    case 'alternar aba': {
      action = 'SWITCH_TAB';
      const target = prompt
        .replace(/^(?:ir|voltar|mudar|alternar)\s+(?:para|pra)?\s*(?:a|as)?\s*(?:aba|guia)s?\s+(?:do|da|de)?\s*/i, '')
        .trim();
      label = `alternar para aba do ${target}`;
      params = { query: target };
      break;
    }

    case 'proxima aba': {
      action = 'NEXT_TAB';
      label = 'próxima aba';
      break;
    }

    case 'aba anterior': {
      action = 'PREV_TAB';
      label = 'aba anterior';
      break;
    }

    case 'reproduzir video': {
      action = 'PLAY_VIDEO';
      label = 'dar play no vídeo';
      break;
    }

    case 'pausar video': {
      action = 'PAUSE_VIDEO';
      label = 'pausar vídeo';
      break;
    }

    case 'controlar audio': {
      action = 'MUTE_VIDEO';
      label = 'mutar/desmutar vídeo';
      break;
    }

    case 'tela cheia': {
      action = 'FULLSCREEN_VIDEO';
      label = 'alternar tela cheia';
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
      label = /v[ií]deo/i.test(prompt) ? 'fechar vídeo (voltar)' : 'voltar página';
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
