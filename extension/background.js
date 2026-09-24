/**
 * Jev Voice - Background Service Worker (Manifest V3)
 * Responsável pelo controle de abas, navegação e ponte para Content Scripts.
 */

// Permite abrir o Side Panel ao clicar no ícone da extensão na barra de ferramentas
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.warn('Erro ao configurar comportamento do sidePanel:', err));
  }
  console.log('Jev Voice Service Worker inicializado com sucesso.');
});

// Listener central de mensagens vindas do Side Panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'EXECUTE_ACTION') {
    handleActionExecution(request.payload)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message || 'Erro desconhecido ao executar ação' }));
    return true; // Mantém a porta de comunicação aberta para resposta assíncrona
  }

  if (request.type === 'PING') {
    sendResponse({ success: true, status: 'PONG' });
    return false;
  }
});

/**
 * Roteia e executa a ação solicitada
 * @param {Object} payload { action: string, params: Object }
 */
async function handleActionExecution(payload) {
  const { action, params = {} } = payload;
  console.log(`[Jev Background] Executando ação: ${action}`, params);

  // Ações de controle de navegador
  switch (action) {
    case 'NEW_TAB': {
      const tab = await chrome.tabs.create({ url: params.url || 'chrome://newtab' });
      return { message: 'Nova aba criada com sucesso.', tabId: tab.id };
    }

    case 'CLOSE_TAB': {
      const activeTab = await getActiveTab();
      if (!activeTab || !activeTab.id) {
        throw new Error('Nenhuma aba ativa identificada para fechar.');
      }
      await chrome.tabs.remove(activeTab.id);
      return { message: 'Aba atual fechada com sucesso.' };
    }

    case 'BACK': {
      const activeTab = await getActiveTab();
      if (!activeTab || !activeTab.id) {
        throw new Error('Nenhuma aba ativa para voltar.');
      }
      await chrome.tabs.goBack(activeTab.id);
      return { message: 'Voltando para a página anterior.' };
    }

    case 'FORWARD': {
      const activeTab = await getActiveTab();
      if (!activeTab || !activeTab.id) {
        throw new Error('Nenhuma aba ativa para avançar.');
      }
      await chrome.tabs.goForward(activeTab.id);
      return { message: 'Avançando para a próxima página.' };
    }

    case 'RELOAD': {
      const activeTab = await getActiveTab();
      if (!activeTab || !activeTab.id) {
        throw new Error('Nenhuma aba ativa para recarregar.');
      }
      await chrome.tabs.reload(activeTab.id);
      return { message: 'Página atualizada com sucesso.' };
    }

    case 'OPEN_URL': {
      let targetUrl = params.url || '';
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://') && !targetUrl.startsWith('chrome://')) {
        targetUrl = 'https://' + targetUrl;
      }
      const activeTab = await getActiveTab();
      if (activeTab && activeTab.id && !activeTab.url?.startsWith('chrome://')) {
        await chrome.tabs.update(activeTab.id, { url: targetUrl });
        return { message: `Navegando para ${targetUrl}` };
      } else {
        const newTab = await chrome.tabs.create({ url: targetUrl });
        return { message: `Aberto ${targetUrl} em nova aba.`, tabId: newTab.id };
      }
    }

    case 'SEARCH_GOOGLE': {
      const query = encodeURIComponent(params.query || '');
      const searchUrl = `https://www.google.com/search?q=${query}`;
      const activeTab = await getActiveTab();
      if (activeTab && activeTab.id && !activeTab.url?.startsWith('chrome://')) {
        await chrome.tabs.update(activeTab.id, { url: searchUrl });
      } else {
        await chrome.tabs.create({ url: searchUrl });
      }
      return { message: `Pesquisa realizada no Google por: "${params.query}"` };
    }

    case 'SEARCH_ON_PAGE': {
      try {
        return await sendToContentScript('SEARCH_ON_PAGE', params);
      } catch (err) {
        // Fallback: Se estiver no YouTube e falhar o content script, navega diretamente na busca do YouTube
        const activeTab = await getActiveTab();
        const query = encodeURIComponent(params.query || '');
        if (activeTab?.url?.includes('youtube.com')) {
          await chrome.tabs.update(activeTab.id, { url: `https://www.youtube.com/results?search_query=${query}` });
          return { message: `Pesquisado "${params.query}" no YouTube.` };
        } else if (activeTab?.url?.includes('mercadolivre.com')) {
          await chrome.tabs.update(activeTab.id, { url: `https://lista.mercadolivre.com.br/${query}` });
          return { message: `Pesquisado "${params.query}" no Mercado Livre.` };
        }
        // Fallback final: Google
        await chrome.tabs.update(activeTab.id, { url: `https://www.google.com/search?q=${query}` });
        return { message: `Pesquisado "${params.query}" no Google.` };
      }
    }

    // Ações delegadas ao Content Script (DOM / Página)
    case 'SCROLL_DOWN':
    case 'SCROLL_UP':
    case 'CLICK_ELEMENT':
    case 'TYPE_TEXT':
    case 'FOCUS_ELEMENT': {
      return await sendToContentScript(action, params);
    }

    default:
      throw new Error(`Ação desconhecida: "${action}"`);
  }
}

/**
 * Obtém a aba ativa na janela atual
 */
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

/**
 * Envia uma mensagem para o content script da aba ativa.
 * Se o content script não responder (ex: aba aberta antes da extensão), injeta e tenta novamente.
 */
async function sendToContentScript(action, params) {
  const activeTab = await getActiveTab();
  if (!activeTab || !activeTab.id) {
    throw new Error('Nenhuma aba ativa encontrada.');
  }

  // Abas restritas do Chrome não aceitam content scripts
  if (activeTab.url?.startsWith('chrome://') || activeTab.url?.startsWith('edge://') || activeTab.url?.startsWith('chrome-extension://')) {
    throw new Error('Não é possível interagir com o conteúdo de páginas do sistema do navegador.');
  }

  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, {
      type: 'PAGE_ACTION',
      action,
      params
    });
    if (!response || !response.success) {
      throw new Error(response?.error || 'Falha ao executar ação na página.');
    }
    return response;
  } catch (err) {
    // Se o content script ainda não foi injetado nesta aba, injetamos dinamicamente e tentamos novamente
    console.warn('[Jev Background] Tentando reinjetar content script:', err.message);
    try {
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ['content.js']
      });

      // Aguarda 100ms para inicialização do listener
      await new Promise(resolve => setTimeout(resolve, 100));

      const retryResponse = await chrome.tabs.sendMessage(activeTab.id, {
        type: 'PAGE_ACTION',
        action,
        params
      });
      return retryResponse;
    } catch (injectErr) {
      throw new Error(`Não foi possível comunicar com a página atual: ${injectErr.message}`);
    }
  }
}
