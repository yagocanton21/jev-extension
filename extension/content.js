/**
 * Jev Voice - Content Script
 * Executa ações no contexto do DOM da página (Scroll, Clique, Digitação, Foco).
 */

(() => {
  // Evita registrar múltiplos listeners caso seja reinjetado dinamicamente
  if (window.__JEV_CONTENT_LOADED__) return;
  window.__JEV_CONTENT_LOADED__ = true;

  console.log('[Jev Voice] Content script ativo na página:', window.location.href);

  // Escuta comandos enviados pelo Background Service Worker
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type !== 'PAGE_ACTION') return;

    try {
      const result = executePageAction(request.action, request.params || {});
      sendResponse({ success: true, ...result });
    } catch (err) {
      console.error('[Jev Voice Content] Erro ao executar ação:', err);
      sendResponse({ success: false, error: err.message || 'Erro no content script' });
    }
  });

  /**
   * Executa a ação solicitada no DOM
   */
  function executePageAction(action, params) {
    switch (action) {
      case 'SCROLL_DOWN': {
        const amount = params.amount || Math.round(window.innerHeight * 0.75);
        window.scrollBy({ top: amount, left: 0, behavior: 'smooth' });
        return { message: `Rolagem para baixo realizada (${amount}px).` };
      }

      case 'SCROLL_UP': {
        const amount = params.amount || Math.round(window.innerHeight * 0.75);
        window.scrollBy({ top: -amount, left: 0, behavior: 'smooth' });
        return { message: `Rolagem para cima realizada (${amount}px).` };
      }

      case 'SEARCH_ON_PAGE': {
        const query = params.query || '';
        if (!query) throw new Error('Termo de busca vazio.');

        // Busca o campo de pesquisa mais compatível da página
        const searchInput = findSearchInputElement();
        if (!searchInput) {
          throw new Error('Nenhum campo de busca encontrado nesta página.');
        }

        highlightElement(searchInput);
        searchInput.focus();

        if (searchInput.isContentEditable) {
          searchInput.textContent = query;
        } else {
          searchInput.value = query;
        }

        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        searchInput.dispatchEvent(new Event('change', { bubbles: true }));

        // Tenta submeter pressionando Enter
        const enterDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
        const enterUp = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
        searchInput.dispatchEvent(enterDown);
        searchInput.dispatchEvent(enterUp);

        // Se o Enter não submeteu o form após 300ms, tenta clicar no botão de lupa/submit do form
        setTimeout(() => {
          const form = searchInput.closest('form');
          if (form) {
            const submitBtn = form.querySelector('button[type="submit"], input[type="submit"], button[aria-label*="pesquis" i], button[aria-label*="search" i], button[id*="search" i]');
            if (submitBtn) {
              submitBtn.click();
            } else {
              form.dispatchEvent(new Event('submit', { bubbles: true }));
            }
          }
        }, 300);

        return { message: `Pesquisa por "${query}" executada diretamente na página atual.` };
      }

      case 'PLAY_VIDEO': {
        return handleVideoControl('play');
      }

      case 'PAUSE_VIDEO': {
        return handleVideoControl('pause');
      }

      case 'TOGGLE_VIDEO': {
        return handleVideoControl('toggle');
      }

      case 'MUTE_VIDEO': {
        return handleVideoControl('toggle_mute');
      }

      case 'FULLSCREEN_VIDEO': {
        return handleVideoControl('fullscreen');
      }

      case 'CLICK_ELEMENT': {
        let target = (params.target || '').trim();

        // Se o usuário falou para dar play, pausar, mutar ou tela cheia diretamente
        if (/^(?:dar\s+)?play(?:\s+no\s+v[ií]deo)?$|^(?:tocar|iniciar|reproduzir|despausar|continuar)(?:\s+o)?(?:\s+v[ií]deo)?$/i.test(target)) {
          return handleVideoControl('play');
        }
        if (/^(?:pausar|pause|parar)(?:\s+o)?(?:\s+v[ií]deo)?$/i.test(target)) {
          return handleVideoControl('pause');
        }
        if (/^(?:mutar|silenciar|tirar\s+o?\s*som|desmutar)(?:\s+o)?(?:\s+v[ií]deo)?$/i.test(target)) {
          return handleVideoControl('toggle_mute');
        }
        if (/^(?:tela\s+cheia|maximizar|sair\s+da\s+tela\s+cheia)(?:\s+o)?(?:\s+v[ií]deo)?$/i.test(target)) {
          return handleVideoControl('fullscreen');
        }

        // Limpa verbos de ação para isolar o que realmente deve ser clicado
        const cleanedActionTarget = target
          .replace(/^(?:abrir|abra|abre|clicar|clique|cliquei|selecionar|selecione|tocar|toque|entrar|entre|acessar|acesse)\s+(?:em|no|na|nos|nas|o|a|os|as|ao|aos|do|da|dos|das|de|pelo|pela|num|numa)?\s*/i, '')
          .replace(/(?:\s+no\s+youtube|\s+no\s+google|\s+na\s+p[aá]gina)$/i, '')
          .trim();

        const searchTarget = cleanedActionTarget || target;
        let element = null;

        // Suporte especial para seleção ordinal (primeiro vídeo, segundo resultado, link de baixo, etc.)
        const isOrdinal = searchTarget.match(/(?:primeir[oa]|1[ºª]?|segund[oa]|2[ºª]?|terceir[oa]|3[ºª]?|quart[oa]|4[ºª]?|quint[oa]|5[ºª]?|sext[oa]|6[ºª]?|s[eé]tim[oa]|7[ºª]?|oitav[oa]|8[ºª]?|non[oa]|9[ºª]?|d[eé]cim[oa]|10[ºª]?|[uú]ltim[oa]|pr[oó]xim[oa]|seguinte|de\s+baixo|abaixo)/i);
        const isGenericOnly = /^(?:o\s+|a\s+|o\s+primeiro\s+|a\s+primeira\s+)?(?:v[ií]deo|resultado|item|link|produto)s?$/i.test(searchTarget);

        if (isOrdinal) {
          element = findOrdinalElement(searchTarget);
        } else if (isGenericOnly) {
          // Se o usuário disser apenas "abrir vídeo" ou "link", assume que é o primeiro
          element = findOrdinalElement('primeiro video');
        }

        // Se não for ordinal ou se especificou o título/assunto (ex: "login openai"), busca por título/conteúdo
        if (!element) {
          element = findBestMatchingElement(searchTarget);
        }

        if (!element) {
          throw new Error(`Não foi possível encontrar o elemento ou vídeo com: "${searchTarget}"`);
        }

        clickElementSafely(element);

        return {
          message: `Clicado em: "${target}"`,
          tagName: element.tagName,
          text: element.innerText?.trim()?.slice(0, 40)
        };
      }

      case 'TYPE_TEXT': {
        const target = params.target || '';
        const textToType = params.text || '';
        let inputEl = null;

        if (target) {
          inputEl = findBestMatchingElement(target, ['input', 'textarea', '[contenteditable="true"]']);
        }

        // Se não especificou alvo ou não encontrou, usa o elemento com foco atual
        if (!inputEl && document.activeElement && isTextInput(document.activeElement)) {
          inputEl = document.activeElement;
        }

        if (!inputEl) {
          // Busca o primeiro campo de texto visível
          inputEl = document.querySelector('input[type="text"], input[type="search"], input:not([type]), textarea');
        }

        if (!inputEl) {
          throw new Error(`Nenhum campo de texto encontrado para digitar.`);
        }

        highlightElement(inputEl);
        inputEl.focus();

        if (inputEl.isContentEditable) {
          inputEl.textContent = textToType;
        } else {
          inputEl.value = textToType;
        }

        // Dispara eventos normais de digitação para que frameworks como React/Vue detectem a alteração
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));

        return { message: `Texto "${textToType}" inserido no campo.` };
      }

      case 'FOCUS_ELEMENT': {
        const target = params.target || '';
        const element = findBestMatchingElement(target);
        if (!element) {
          throw new Error(`Elemento "${target}" não encontrado para focar.`);
        }
        highlightElement(element);
        element.focus();
        return { message: `Foco aplicado no elemento "${target}".` };
      }

      default:
        throw new Error(`Ação de página desconhecida: "${action}"`);
    }
  }

  /**
   * Executa o clique de forma completa disparando a sequência correta de eventos
   * e garantindo a navegação se for um link.
   */
  function clickElementSafely(element) {
    if (!element) return;

    // Se o elemento estiver dentro de um link <a> ou for um link <a>, prioriza o link
    const linkEl = element.tagName === 'A' ? element : (element.closest('a') || element);

    highlightElement(linkEl);
    linkEl.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    linkEl.focus?.();

    // Eventos completos de mouse e ponteiro para compatibilidade com Polymer/React/Vue
    const eventTypes = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    for (const type of eventTypes) {
      const evt = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        buttons: 1
      });
      linkEl.dispatchEvent(evt);
    }

    if (typeof linkEl.click === 'function') {
      linkEl.click();
    }

    // Se for link com href real (ex: /watch?v=...), garante a navegação se o SPA não reagir
    const rawHref = linkEl.getAttribute('href') || linkEl.href;
    if (rawHref && !rawHref.startsWith('javascript:') && !rawHref.startsWith('#')) {
      const fullUrl = linkEl.href || (rawHref.startsWith('http') ? rawHref : window.location.origin + (rawHref.startsWith('/') ? rawHref : '/' + rawHref));
      setTimeout(() => {
        // Se após 350ms a página não tiver navegado
        if (window.location.href !== fullUrl && !window.location.href.includes(rawHref.split('?')[0])) {
          console.log('[Jev Voice] Navegando via URL para:', fullUrl);
          window.location.href = fullUrl;
        }
      }, 350);
    }
  }

  /**
   * Destaca visualmente o elemento acionado para feedback ao usuário
   */
  function highlightElement(el) {
    const originalOutline = el.style.outline;
    const originalTransition = el.style.transition;
    el.style.transition = 'outline 0.2s ease-in-out';
    el.style.outline = '3px solid #FF6B00';
    setTimeout(() => {
      el.style.outline = originalOutline;
      el.style.transition = originalTransition;
    }, 1200);
  }

  function isTextInput(el) {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea' || el.isContentEditable) return true;
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      return ['text', 'search', 'email', 'url', 'number', 'tel'].includes(type);
    }
    return false;
  }

  /**
   * Normaliza textos removendo acentos, pontuações e unificando termos comuns falados
   * (ex: "log in" -> "login", "open ai" -> "openai", "chat gpt" -> "chatgpt")
   */
  function normalizeText(text) {
    if (!text) return '';
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove acentos
      .toLowerCase()
      .replace(/\blog\s+in\b/g, 'login') // "log in" -> "login"
      .replace(/\bopen\s+ai\b/g, 'openai') // "open ai" -> "openai"
      .replace(/\bchat\s+gpt\b/g, 'chatgpt') // "chat gpt" -> "chatgpt"
      .replace(/\byou\s+tube\b/g, 'youtube') // "you tube" -> "youtube"
      .replace(/\bmercado\s+livre\b/g, 'mercadolivre') // "mercado livre" -> "mercadolivre"
      .replace(/[^a-z0-9\s]/g, ' ') // Remove pontuações
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Distância de Levenshtein para tolerar pequenos erros de transcrição de voz
   * (ex: "opeai" vs "openai" -> distância 1)
   */
  function levenshteinDistance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substituição
            matrix[i][j - 1] + 1,     // inserção
            matrix[i - 1][j] + 1      // deleção
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }

  /**
   * Verifica se uma palavra da query corresponde a alguma palavra do elemento
   * suportando correspondência exata, prefixo e distância de Levenshtein
   */
  function wordMatchesFuzzy(queryWord, targetWords) {
    if (!queryWord) return false;
    for (const tw of targetWords) {
      if (!tw) continue;
      if (tw === queryWord) return true;
      if (queryWord.length >= 4 && (tw.startsWith(queryWord) || queryWord.startsWith(tw))) return true;
      const maxDist = queryWord.length >= 6 ? 2 : (queryWord.length >= 4 ? 1 : 0);
      if (maxDist > 0 && Math.abs(tw.length - queryWord.length) <= maxDist) {
        if (levenshteinDistance(queryWord, tw) <= maxDist) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Converte texto ordinal em índice numérico (0-based)
   */
  function parseOrdinalIndex(text) {
    const t = text.toLowerCase();
    if (t.includes('ultim') || t.includes('últim')) return -1;
    if (t.includes('primeir') || t.match(/\b1[ºª]?\b/)) return 0;
    if (t.includes('segund') || t.match(/\b2[ºª]?\b/) || t.includes('baixo') || t.includes('proxim') || t.includes('próxim') || t.includes('seguinte')) return 1;
    if (t.includes('terceir') || t.match(/\b3[ºª]?\b/)) return 2;
    if (t.includes('quart') || t.match(/\b4[ºª]?\b/)) return 3;
    if (t.includes('quint') || t.match(/\b5[ºª]?\b/)) return 4;
    if (t.includes('sext') || t.match(/\b6[ºª]?\b/)) return 5;
    if (t.includes('setim') || t.includes('sétim') || t.match(/\b7[ºª]?\b/)) return 6;
    if (t.includes('oitav') || t.match(/\b8[ºª]?\b/)) return 7;
    if (t.includes('non') || t.match(/\b9[ºª]?\b/)) return 8;
    if (t.includes('decim') || t.includes('décim') || t.match(/\b10[ºª]?\b/)) return 9;
    return 0;
  }

  /**
   * Localiza de forma semântica e heurística o elemento interativo mais condizente com a fala
   */
  function findBestMatchingElement(query, tagFilters = null) {
    if (!query) return null;

    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return null;

    // Remove prefixos falados de comandos ou contexto
    const cleanedQuery = normalizedQuery
      .replace(/^(?:o\s+|a\s+|o\s+video\s+|video\s+|com\s+o\s+titulo\s+|titulo\s+|chamado\s+|sobre\s+|da\s+|do\s+|de\s+|link\s+|resultado\s+)+/i, '')
      .replace(/(?:\s+no\s+youtube|\s+no\s+google|\s+na\s+pagina)$/i, '')
      .trim();

    const effectiveQuery = cleanedQuery || normalizedQuery;

    // Palavras-chave individuais da busca
    const stopWords = new Set(['com', 'uma', 'uns', 'umas', 'para', 'pra', 'por', 'sobre', 'que', 'dos', 'das', 'seu', 'sua', 'ele', 'ela']);
    const queryTokens = effectiveQuery
      .split(/\s+/)
      .filter(w => w.length >= 2 && !stopWords.has(w));

    const selector = tagFilters
      ? tagFilters.join(', ')
      : 'button, a, input, textarea, select, [role="button"], [role="link"], [aria-label], [title], [placeholder], #video-title, #video-title-link, h1, h2, h3, ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer';

    const candidates = Array.from(document.querySelectorAll(selector));
    let bestMatch = null;
    let highestScore = -1;

    for (const el of candidates) {
      if (!isElementVisible(el)) continue;

      // Ignora menus laterais/guia se o usuário não pediu menu especificamente
      const inSidebar = el.closest('nav, aside, #guide, ytd-guide-renderer, ytd-mini-guide-renderer, #sidebar, [role="navigation"]');
      if (inSidebar && !normalizedQuery.includes('menu') && !normalizedQuery.includes('lateral') && !normalizedQuery.includes('guia')) {
        continue;
      }

      const rawText = el.innerText || el.textContent || '';
      const normText = normalizeText(rawText);
      const normAria = normalizeText(el.getAttribute('aria-label') || '');
      const normTitle = normalizeText(el.getAttribute('title') || '');
      const normPlaceholder = normalizeText(el.getAttribute('placeholder') || '');
      const normHref = normalizeText(el.getAttribute('href') || el.href || '');

      const targetWords = (normText + ' ' + normAria + ' ' + normTitle)
        .split(/\s+/)
        .filter(w => w.length >= 2);

      let score = 0;

      // 1. Correspondência exata da query inteira normalizada
      if (normText === effectiveQuery || normAria === effectiveQuery) {
        score = 100;
      } else if (normTitle === effectiveQuery || normPlaceholder === effectiveQuery) {
        score = 95;
      }
      // 2. Contém a query inteira
      else if (normText.includes(effectiveQuery) || normAria.includes(effectiveQuery)) {
        score = 90;
      } else if (normTitle.includes(effectiveQuery)) {
        score = 85;
      }
      // 3. Correspondência por palavras-chave com tolerância fuzzy (Levenshtein)
      else if (queryTokens.length > 0) {
        let matchedCount = 0;
        for (const token of queryTokens) {
          if (wordMatchesFuzzy(token, targetWords) || (token.length >= 4 && normHref.includes(token))) {
            matchedCount++;
          }
        }

        if (matchedCount > 0) {
          const ratio = matchedCount / queryTokens.length;
          // Se encontrou todas as palavras ou pelo menos 45% com peso em palavras longas
          if (ratio >= 0.45 || (matchedCount >= 1 && queryTokens.some(t => t.length >= 5 && wordMatchesFuzzy(t, targetWords)))) {
            score = Math.round(50 + ratio * 35);
          }
        }
      }

      // Bônus para elementos clicáveis diretos (<a>, <button>, role="link")
      const isDirectInteractive = el.tagName === 'A' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'link' || el.getAttribute('role') === 'button';
      if (isDirectInteractive) {
        score += 15;
      }

      // Penalidade de tamanho para evitar selecionar blocos inteiros da página
      if (score > 0 && normText.length > 0) {
        const extraChars = Math.max(0, normText.length - effectiveQuery.length);
        score -= Math.min(30, Math.floor(extraChars / 8));
      }

      if (score > highestScore && score >= 35) {
        highestScore = score;

        if (el.tagName && el.tagName.toLowerCase().startsWith('ytd-')) {
          bestMatch = el.querySelector('a#video-title-link, a#video-title, a#thumbnail, a[href*="/watch"], a[href*="/live"]') || el.querySelector('a') || el;
        } else {
          bestMatch = el.tagName === 'A' ? el : (el.closest('a') || el);
        }
      }
    }

    return bestMatch;
  }

  /**
   * Localiza elementos pela ordem na tela (ex: primeiro vídeo, segundo resultado)
   */
  function findOrdinalElement(targetQuery) {
    const targetIndex = parseOrdinalIndex(targetQuery);

    // Se estiver no YouTube, busca os vídeos na página atual (Home, Busca ou Lateral de recomendados)
    if (window.location.hostname.includes('youtube.com')) {
      const isWatchPage = window.location.pathname.includes('/watch');

      // Ordem de preferência de seletores dependendo se está no player ou na página principal
      const selectors = isWatchPage
        ? [
            'ytd-compact-video-renderer',
            'ytd-rich-item-renderer:not([is-slim-media])',
            'ytd-video-renderer'
          ]
        : [
            'ytd-rich-item-renderer:not([is-slim-media])',
            'ytd-video-renderer',
            'ytd-compact-video-renderer',
            'ytd-grid-video-renderer'
          ];

      let videoContainers = [];
      for (const sel of selectors) {
        const found = Array.from(document.querySelectorAll(sel)).filter(container => {
          // Ignora qualquer container que esteja dentro da barra lateral de navegação (guide)
          if (container.closest('ytd-guide-renderer, #guide, #guide-content, ytd-mini-guide-renderer')) return false;
          return isElementVisible(container);
        });

        if (found.length > 0) {
          videoContainers = found;
          break;
        }
      }

      if (videoContainers.length > 0) {
        const targetContainer = targetIndex === -1
          ? videoContainers[videoContainers.length - 1]
          : (videoContainers[targetIndex] || videoContainers[0]);

        if (targetContainer) {
          const clickable = targetContainer.querySelector('a#video-title-link, a#video-title, a#thumbnail, a[href*="/watch"], a[href*="/live"], a[href*="/shorts"]') || targetContainer.querySelector('a');
          if (clickable) return clickable;
          return targetContainer;
        }
      }

      // Fallback para YouTube: links diretos com /watch ou /live que NÃO estejam na barra lateral
      const directLinks = Array.from(document.querySelectorAll('a[href*="/watch"], a[href*="/live"]')).filter(el => {
        if (el.closest('ytd-guide-renderer, #guide, #guide-content, ytd-mini-guide-renderer, nav, aside')) return false;
        return isElementVisible(el);
      });

      if (directLinks.length > 0) {
        // Remove duplicatas de links do mesmo vídeo (thumbnail + título)
        const seenUrls = new Set();
        const uniqueLinks = [];
        for (const link of directLinks) {
          const hrefPath = (link.getAttribute('href') || '').split('&')[0];
          if (hrefPath && !seenUrls.has(hrefPath)) {
            seenUrls.add(hrefPath);
            uniqueLinks.push(link);
          }
        }

        if (uniqueLinks.length > 0) {
          return targetIndex === -1
            ? uniqueLinks[uniqueLinks.length - 1]
            : (uniqueLinks[targetIndex] || uniqueLinks[0]);
        }
      }
    }

    // ==========================================
    // 2. MERCADO LIVRE (Busca, Anúncios, Produtos)
    // ==========================================
    if (window.location.hostname.includes('mercadolivre')) {
      const items = Array.from(document.querySelectorAll(
        'li.ui-search-layout__item, .ui-search-result, .poly-card, .ui-search-layout__item, div[class*="ui-search-result"]'
      )).filter(el => {
        // Ignora qualquer coisa na barra lateral de filtros (ui-search-sidebar)
        if (el.closest('.ui-search-sidebar, aside, nav')) return false;
        return isElementVisible(el);
      });

      if (items.length > 0) {
        const targetItem = targetIndex === -1 ? items[items.length - 1] : (items[targetIndex] || items[0]);
        if (targetItem) {
          const link = targetItem.querySelector('a.poly-component__title, a.ui-search-link, a.poly-card__title, a[href*="/MLB-"], a[href*="/p/"], h2 a, h3 a') || targetItem.querySelector('a');
          if (link) return link;
          return targetItem;
        }
      }
    }

    // ==========================================
    // 3. GOOGLE (Resultados de Busca)
    // ==========================================
    if (window.location.hostname.includes('google.')) {
      const results = Array.from(document.querySelectorAll('h3'))
        .map(h3 => h3.closest('a') || h3.querySelector('a') || h3.parentElement?.closest('a'))
        .filter(el => el && el.tagName === 'A' && isElementVisible(el));
        
      if (results.length > 0) {
        return targetIndex === -1 ? results[results.length - 1] : (results[targetIndex] || results[0]);
      }
    }

    // ==========================================
    // 4. ADAPTADOR UNIVERSAL / GENÉRICO
    // ==========================================
    const searchResultLinks = Array.from(document.querySelectorAll('h3 a, a.ui-search-link, h2 a, .result__title a, h3, h2'))
      .filter(el => {
        // Ignora qualquer cabeçalho ou link de menus laterais, filtros, navegação, rodapé
        if (el.closest('nav, aside, #guide, ytd-guide-renderer, ytd-mini-guide-renderer, #sidebar, .sidebar, [class*="sidebar"], [class*="filter"], header, footer, [role="navigation"]')) return false;
        return isElementVisible(el);
      })
      .map(el => (el.tagName === 'A' ? el : el.closest('a')) || el)
      .filter(el => el && isElementVisible(el));

    if (searchResultLinks.length > 0) {
      return targetIndex === -1
        ? searchResultLinks[searchResultLinks.length - 1]
        : (searchResultLinks[targetIndex] || searchResultLinks[0]);
    }

    return null;
  }

  /**
   * Identifica o campo de busca mais provável da página atual (YouTube, Mercado Livre, etc.)
   */
  function findSearchInputElement() {
    // 1. Seletores clássicos de busca
    const selectors = [
      'input[name="search_query"]', // YouTube
      'input[id="search"]',         // YouTube desktop
      'input[name="as_word"]',      // Mercado Livre
      'input[type="search"]',
      'input[aria-label*="pesquis" i]',
      'input[aria-label*="search" i]',
      'input[placeholder*="pesquis" i]',
      'input[placeholder*="buscar" i]',
      'input[placeholder*="search" i]',
      'input[name="q"]',
      'input[name="query"]'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isElementVisible(el)) {
        return el;
      }
    }

    // 2. Fallback: Primeiro input de texto visível na tela
    const allInputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
    return allInputs.find(el => isElementVisible(el)) || null;
  }

  /**
   * Verifica se o elemento está visível na tela
   */
  function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return true;
    }
    return Boolean(el.offsetParent !== null || el.children.length > 0);
  }

  /**
   * Controla a reprodução de vídeo na página (YouTube, HTML5 video, etc.)
   */
  function handleVideoControl(command) {
    const video = document.querySelector('video');
    const ytPlayBtn = document.querySelector('.ytp-play-button');

    if (command === 'play') {
      if (video) {
        if (video.paused) {
          if (ytPlayBtn) {
            ytPlayBtn.click();
          } else {
            video.play().catch(() => {});
          }
        }
        return { message: 'Vídeo em reprodução (Play).' };
      }
      if (ytPlayBtn) {
        ytPlayBtn.click();
        return { message: 'Play acionado.' };
      }
    }

    if (command === 'pause') {
      if (video) {
        if (!video.paused) {
          if (ytPlayBtn) {
            ytPlayBtn.click();
          } else {
            video.pause();
          }
        }
        return { message: 'Vídeo pausado.' };
      }
      if (ytPlayBtn) {
        ytPlayBtn.click();
        return { message: 'Pausa acionada.' };
      }
    }

    if (command === 'toggle') {
      if (ytPlayBtn) {
        ytPlayBtn.click();
        return { message: 'Play/Pause alternado.' };
      }
      if (video) {
        if (video.paused) video.play().catch(() => {});
        else video.pause();
        return { message: video.paused ? 'Vídeo pausado.' : 'Vídeo em reprodução.' };
      }
    }

    if (command === 'toggle_mute') {
      const ytMuteBtn = document.querySelector('.ytp-mute-button');
      if (ytMuteBtn) {
        ytMuteBtn.click();
        return { message: 'Áudio do vídeo alternado.' };
      }
      if (video) {
        video.muted = !video.muted;
        return { message: video.muted ? 'Vídeo mutado.' : 'Áudio do vídeo ativado.' };
      }
    }

    if (command === 'fullscreen') {
      const ytFsBtn = document.querySelector('.ytp-fullscreen-button');
      if (ytFsBtn) {
        ytFsBtn.click();
        return { message: 'Tela cheia alternada.' };
      }
      if (video) {
        if (!document.fullscreenElement) {
          if (video.requestFullscreen) video.requestFullscreen().catch(() => {});
        } else {
          if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
        }
        return { message: 'Tela cheia alternada.' };
      }
    }

    // Fallback para players genéricos na web
    const fallbackBtn = document.querySelector('button[aria-label*="Play" i], button[aria-label*="Reproduzir" i], button[aria-label*="Pausar" i], button[aria-label*="Pause" i]');
    if (fallbackBtn) {
      fallbackBtn.click();
      return { message: 'Controle de reprodução acionado.' };
    }

    throw new Error('Nenhum vídeo em reprodução encontrado nesta página.');
  }
})();
