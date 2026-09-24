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

      case 'CLICK_ELEMENT': {
        const target = params.target || '';
        const element = findBestMatchingElement(target);
        if (!element) {
          throw new Error(`Não foi possível encontrar o elemento correspondente a: "${target}"`);
        }
        highlightElement(element);
        element.focus?.();
        element.click();
        return {
          message: `Elemento "${target}" clicado com sucesso.`,
          tagName: element.tagName,
          text: element.innerText?.trim()?.slice(0, 30)
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
   * Localiza de forma heurística o elemento interativo mais condizente com o texto falado
   */
  function findBestMatchingElement(query, tagFilters = null) {
    if (!query) return null;
    const normalizedQuery = query.toLowerCase().trim();

    const selector = tagFilters
      ? tagFilters.join(', ')
      : 'button, a, input, textarea, select, [role="button"], [role="link"], [aria-label], [title], [placeholder]';

    const candidates = Array.from(document.querySelectorAll(selector));
    let bestMatch = null;
    let highestScore = -1;

    for (const el of candidates) {
      if (!isElementVisible(el)) continue;

      const innerText = (el.innerText || el.textContent || '').toLowerCase().trim();
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase().trim();
      const placeholder = (el.getAttribute('placeholder') || '').toLowerCase().trim();
      const title = (el.getAttribute('title') || '').toLowerCase().trim();
      const name = (el.getAttribute('name') || '').toLowerCase().trim();
      const id = (el.id || '').toLowerCase().trim();

      let score = 0;

      // Correspondência exata
      if (innerText === normalizedQuery || ariaLabel === normalizedQuery) {
        score = 100;
      } else if (placeholder === normalizedQuery || title === normalizedQuery) {
        score = 90;
      }
      // Contém a query inteira
      else if (innerText.includes(normalizedQuery)) {
        score = 80 - Math.min(30, innerText.length - normalizedQuery.length);
      } else if (ariaLabel.includes(normalizedQuery)) {
        score = 75;
      } else if (placeholder.includes(normalizedQuery) || title.includes(normalizedQuery)) {
        score = 70;
      } else if (name.includes(normalizedQuery) || id.includes(normalizedQuery)) {
        score = 50;
      }

      if (score > highestScore && score >= 40) {
        highestScore = score;
        bestMatch = el;
      }
    }

    return bestMatch;
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
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
})();
