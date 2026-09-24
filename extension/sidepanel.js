const state = {
  isListening: false,
  recognition: null,
  model: 'typesafe/jev',
  stats: {
    calls: 0,
    actions: 0,
    totalCost: 0.000000,
    lastLatency: 0
  },
  settings: {
    backendUrl: 'http://163.176.205.54:8092',
    minConfidence: 70,
    engineMode: 'backend' // 'local' ou 'backend'
  }
};

// ==========================================
// Elementos do DOM
// ==========================================
const elements = {
  btnVoiceToggle: document.getElementById('btnVoiceToggle'),
  voiceButtonText: document.getElementById('voiceButtonText'),
  voiceStatus: document.getElementById('voiceStatus'),
  recordingBadge: document.getElementById('recordingBadge'),
  transcriptionBox: document.getElementById('transcriptionBox'),

  statModel: document.getElementById('statModel'),
  statLatency: document.getElementById('statLatency'),
  statCalls: document.getElementById('statCalls'),
  statActions: document.getElementById('statActions'),
  statCost: document.getElementById('statCost'),

  decisionBadge: document.getElementById('decisionBadge'),
  decisionAction: document.getElementById('decisionAction'),
  decisionConfidence: document.getElementById('decisionConfidence'),
  probabilitiesList: document.getElementById('probabilitiesList'),

  textCommandForm: document.getElementById('textCommandForm'),
  inputCommand: document.getElementById('inputCommand'),

  logContainer: document.getElementById('logContainer'),
  btnClearLog: document.getElementById('btnClearLog'),

  btnSettings: document.getElementById('btnSettings'),
  settingsModal: document.getElementById('settingsModal'),
  btnCloseSettings: document.getElementById('btnCloseSettings'),
  btnSaveSettings: document.getElementById('btnSaveSettings'),
  cfgBackendUrl: document.getElementById('cfgBackendUrl'),
  cfgMinConfidence: document.getElementById('cfgMinConfidence'),
  cfgEngineMode: document.getElementById('cfgEngineMode')
};

// ==========================================
// Inicialização
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupSpeechRecognition();
  setupEventListeners();

  // Escuta confirmação de permissão concedida pela aba permission.html
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'MIC_PERMISSION_GRANTED') {
        addLog('✅', 'Microfone autorizado com sucesso! Iniciando escuta...');
        setTimeout(() => {
          startListening();
        }, 500);
      }
    });
  }

  addLog('ℹ️', 'Extensão Jev Voice pronta para receber comandos.');
});

// ==========================================
// Gerenciamento de Configurações
// ==========================================
async function loadSettings() {
  if (chrome.storage && chrome.storage.local) {
    const saved = await chrome.storage.local.get(['jev_settings']);
    if (saved.jev_settings) {
      state.settings = { ...state.settings, ...saved.jev_settings };
    }
  }
  state.settings.engineMode = 'backend';
  state.model = 'typesafe/jev';

  elements.cfgBackendUrl.value = state.settings.backendUrl;
  elements.cfgMinConfidence.value = state.settings.minConfidence;
  elements.cfgEngineMode.value = state.settings.engineMode;

  updateStatsDisplay();

  // Verifica se o backend local está respondendo
  try {
    const health = await fetch(`${state.settings.backendUrl}/health`).then(r => r.json());
    if (health.status === 'online') {
      addLog('⚡', `Conectado ao servidor JEV (modelo: ${health.model || 'typesafe/jev'}).`);
    }
  } catch (e) {
    addLog('ℹ️', 'Servidor backend local pronto.');
  }
}

async function saveSettings() {
  state.settings.backendUrl = elements.cfgBackendUrl.value.trim();
  state.settings.minConfidence = parseInt(elements.cfgMinConfidence.value, 10) || 70;
  state.settings.engineMode = elements.cfgEngineMode.value;

  if (chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ jev_settings: state.settings });
  }

  elements.settingsModal.classList.add('hidden');
  addLog('⚙️', `Configurações salvas. Motor: ${state.settings.engineMode === 'local' ? 'Local V1' : 'Backend Jev'}`);
}

// ==========================================
// Configuração do Web Speech API
// ==========================================
function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    elements.voiceStatus.textContent = 'Web Speech API não suportada neste ambiente.';
    elements.btnVoiceToggle.disabled = true;
    addLog('❌', 'Navegador não possui suporte para Web Speech API.');
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'pt-BR';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    state.isListening = true;
    updateVoiceUI(true);
    elements.voiceStatus.textContent = 'Ouvindo microfone...';
    elements.transcriptionBox.classList.remove('placeholder');
    elements.transcriptionBox.classList.add('active');
    elements.transcriptionBox.textContent = 'Fale agora...';
  };

  recognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const transcriptPiece = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcriptPiece;
      } else {
        interimTranscript += transcriptPiece;
      }
    }

    // Exibe transcrição em tempo real
    if (interimTranscript) {
      elements.transcriptionBox.innerHTML = `<span>${finalTranscript}</span><span style="color: #9BA3AF;"> ${interimTranscript}</span>`;
    }

    // Processa comando final reconhecido
    if (finalTranscript.trim()) {
      elements.transcriptionBox.textContent = finalTranscript.trim();
      handleSpokenText(finalTranscript.trim());
    }
  };

  recognition.onerror = (event) => {
    console.warn('[Jev Voice] Erro no reconhecimento:', event.error);
    if (event.error === 'not-allowed') {
      elements.voiceStatus.textContent = 'Permissão necessária. Abrindo aba...';
      addLog('🎙️', 'O Chrome precisa que você autorize o microfone na aba que foi aberta.');
      stopListening();
      // Abre a aba de autorização da extensão para disparar o prompt nativo do Chrome
      if (chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
      }
    } else if (event.error === 'no-speech') {
      elements.voiceStatus.textContent = 'Nenhuma fala detectada.';
    } else {
      elements.voiceStatus.textContent = `Erro: ${event.error}`;
      addLog('⚠️', `Erro na captura de áudio: ${event.error}`);
    }
  };

  recognition.onend = () => {
    if (state.isListening) {
      // Reinicia automaticamente se o usuário ainda não clicou em parar
      try {
        recognition.start();
      } catch (e) {
        state.isListening = false;
        updateVoiceUI(false);
      }
    } else {
      updateVoiceUI(false);
      elements.voiceStatus.textContent = 'Pronto para ouvir';
    }
  };

  state.recognition = recognition;
}

function startListening() {
  if (!state.recognition) return;
  try {
    state.recognition.start();
  } catch (err) {
    console.error('Falha ao iniciar SpeechRecognition:', err);
  }
}

function stopListening() {
  state.isListening = false;
  if (state.recognition) {
    try {
      state.recognition.stop();
    } catch (err) {
      // Ignora erro ao forçar parada
    }
  }
  updateVoiceUI(false);
}

function updateVoiceUI(isListening) {
  if (isListening) {
    elements.btnVoiceToggle.classList.add('listening');
    elements.voiceButtonText.textContent = 'PARAR';
    elements.recordingBadge.classList.remove('hidden');
  } else {
    elements.btnVoiceToggle.classList.remove('listening');
    elements.voiceButtonText.textContent = 'OUVIR';
    elements.recordingBadge.classList.add('hidden');
    elements.transcriptionBox.classList.remove('active');
  }
}

async function handleSpokenText(rawText) {
  const startTime = performance.now();
  state.stats.calls++;
  updateStatsDisplay();

  addLog('🎤', `"${rawText}"`, 'voice');

  // Obtém contexto da aba ativa
  let activeTab = null;
  if (chrome.tabs && chrome.tabs.query) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab || null;
  }

  let decisionResult = null;

  if (state.settings.engineMode === 'backend') {
    decisionResult = await callJevBackend(rawText, activeTab);
  } else {
    decisionResult = interpretCommandLocally(rawText, activeTab);
  }

  const latencyMs = Math.round(performance.now() - startTime);
  state.stats.lastLatency = latencyMs;
  updateStatsDisplay();

  renderDecision(decisionResult);

  // Validação de confiança mínima
  if (decisionResult.confidence * 100 < state.settings.minConfidence) {
    setDecisionStatus('uncertain', 'DÚVIDA');
    addLog('⚠️', `Não tenho certeza do que você quis fazer (confiança: ${Math.round(decisionResult.confidence * 100)}%).`);
    return;
  }

  if (decisionResult.action === 'UNKNOWN') {
    setDecisionStatus('uncertain', 'DÚVIDA');
    addLog('❓', 'Comando não compreendido.');
    return;
  }

  // Trava de Segurança: Ações potencialmente sensíveis exigem confirmação explícita
  if (decisionResult.is_sensitive) {
    setDecisionStatus('uncertain', 'CONFIRMAR');
    addLog('⚠️', `Esta ação precisa de confirmação: "${decisionResult.label || decisionResult.action}".`);
    showSecurityConfirmation(decisionResult);
    return;
  }

  // Execução da Ação
  addLog('🧠', `Jev → ${decisionResult.action}`, 'decision');
  await executeAction(decisionResult.action, decisionResult.params, decisionResult.label);
}

function showSecurityConfirmation(decision) {
  const confirmContainer = document.createElement('div');
  confirmContainer.className = 'log-item confirmation-box';
  confirmContainer.innerHTML = `
    <span class="log-time">SEG</span>
    <span class="log-icon">🛡️</span>
    <div style="display:flex; flex-direction:column; gap:4px;">
      <span style="color: #FF9500; font-weight: bold;">Confirmar ação: "${escapeHtml(decision.label)}"?</span>
      <div style="display:flex; gap:6px;">
        <button id="btnCancelSensitive" style="background:#2C313D; border:1px solid #4B5563; color:#fff; border-radius:4px; padding:3px 8px; font-size:11px; cursor:pointer;">Cancelar</button>
        <button id="btnConfirmSensitive" style="background:#FF6B00; border:none; color:#fff; border-radius:4px; padding:3px 8px; font-size:11px; font-weight:bold; cursor:pointer;">Confirmar</button>
      </div>
    </div>
  `;

  elements.logContainer.appendChild(confirmContainer);
  elements.logContainer.scrollTop = elements.logContainer.scrollHeight;

  confirmContainer.querySelector('#btnCancelSensitive').addEventListener('click', () => {
    confirmContainer.remove();
    addLog('🚫', 'Ação sensível cancelada pelo usuário.');
    setDecisionStatus('waiting', 'CANCELADO');
  });

  confirmContainer.querySelector('#btnConfirmSensitive').addEventListener('click', async () => {
    confirmContainer.remove();
    addLog('🧠', `Jev → ${decision.action} (Confirmado)`, 'decision');
    await executeAction(decision.action, decision.params, decision.label);
  });
}

/**
 * Motor de classificação local V1 com cálculo de probabilidades
 */
function interpretCommandLocally(rawText, activeTab = null) {
  const normalized = rawText
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos para flexibilidade
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
    .trim();

  // Dicionário de probabilidades base
  const probs = {
    'abrir site': 0.00,
    'nova aba': 0.00,
    'fechar aba': 0.00,
    'rolar pagina': 0.00,
    'pesquisar': 0.00,
    'navegacao': 0.00
  };

  // 1. Nova Aba
  if (normalized.includes('nova aba') || normalized.includes('abrir aba') || normalized.includes('criar aba')) {
    probs['nova aba'] = 0.98;
    probs['abrir site'] = 0.01;
    return {
      action: 'NEW_TAB',
      label: 'abrir nova aba',
      confidence: 0.98,
      params: {},
      probabilities: probs
    };
  }

  // 2. Fechar Aba
  if (normalized.includes('fechar aba') || normalized.includes('fecha aba') || normalized.includes('feche essa aba') || normalized.includes('fechar essa aba')) {
    probs['fechar aba'] = 0.99;
    return {
      action: 'CLOSE_TAB',
      label: 'fechar aba',
      confidence: 0.99,
      params: {},
      probabilities: probs
    };
  }

  // 3. Voltar / Avançar
  if (normalized.includes('voltar') || normalized.includes('volte') || normalized.includes('pagina anterior')) {
    probs['navegacao'] = 0.96;
    return {
      action: 'BACK',
      label: 'voltar página',
      confidence: 0.96,
      params: {},
      probabilities: probs
    };
  }

  if (normalized.includes('avancar') || normalized.includes('avance') || normalized.includes('proxima pagina')) {
    probs['navegacao'] = 0.96;
    return {
      action: 'FORWARD',
      label: 'avançar página',
      confidence: 0.96,
      params: {},
      probabilities: probs
    };
  }

  // 4. Atualizar / Recarregar
  if (normalized.includes('atualizar') || normalized.includes('atualize') || normalized.includes('recarregar') || normalized.includes('recarregue')) {
    probs['navegacao'] = 0.95;
    return {
      action: 'RELOAD',
      label: 'atualizar página',
      confidence: 0.95,
      params: {},
      probabilities: probs
    };
  }

  // 5. Rolar para baixo
  if (normalized.includes('rolar para baixo') || normalized.includes('role para baixo') || normalized.includes('descer') || normalized.includes('desce') || normalized.includes('rola para baixo')) {
    probs['rolar pagina'] = 0.97;
    return {
      action: 'SCROLL_DOWN',
      label: 'rolar para baixo',
      confidence: 0.97,
      params: {},
      probabilities: probs
    };
  }

  // 6. Rolar para cima
  if (normalized.includes('rolar para cima') || normalized.includes('role para cima') || normalized.includes('subir') || normalized.includes('sobe') || normalized.includes('rola para cima')) {
    probs['rolar pagina'] = 0.97;
    return {
      action: 'SCROLL_UP',
      label: 'rolar para cima',
      confidence: 0.97,
      params: {},
      probabilities: probs
    };
  }

  // 7. Pesquisar (com inteligência de contexto de página)
  const searchMatch = normalized.match(/^(?:pesquis[ae]|procur[ae]|busqu[ae]|pesquisar)\s+(?:por\s+)?(.+?)(?:\s+no google)?$/i);
  if (searchMatch && searchMatch[1]) {
    const rawTerm = searchMatch[1].replace(/no google$/, '').trim();
    probs['pesquisar'] = 0.96;
    probs['abrir site'] = 0.02;

    const isExplicitGoogle = normalized.includes('no google');
    const isYouTube = activeTab?.url?.includes('youtube.com');
    const isMercadoLivre = activeTab?.url?.includes('mercadolivre.com');

    if (!isExplicitGoogle && (isYouTube || isMercadoLivre)) {
      return {
        action: 'SEARCH_ON_PAGE',
        label: `pesquisar "${rawTerm}" na página`,
        confidence: 0.96,
        params: { query: rawTerm },
        probabilities: probs
      };
    }

    return {
      action: 'SEARCH_GOOGLE',
      label: `pesquisar "${rawTerm}" no Google`,
      confidence: 0.95,
      params: { query: rawTerm },
      probabilities: probs
    };
  }

  // 8. Abrir Sites Genéricos (Mercado Livre, YouTube, Gmail, Amazon, etc.)
  const openMatch = normalized.match(/^(?:abrir|abra|abre|acessar|acesse|ir para|vai para)\s+(?:o|a|ao)?\s*(.+)$/i);
  if (openMatch && openMatch[1]) {
    const rawTarget = openMatch[1].trim();
    probs['abrir site'] = 0.98;
    probs['pesquisar'] = 0.02;

    const siteMap = {
      'mercado livre': 'https://www.mercadolivre.com.br',
      'mercadolivre': 'https://www.mercadolivre.com.br',
      'youtube': 'https://www.youtube.com',
      'gmail': 'https://mail.google.com',
      'google': 'https://www.google.com',
      'amazon': 'https://www.amazon.com.br',
      'github': 'https://github.com',
      'chatgpt': 'https://chatgpt.com',
      'whatsapp': 'https://web.whatsapp.com',
      'instagram': 'https://www.instagram.com',
      'twitter': 'https://x.com',
      'x': 'https://x.com',
      'reddit': 'https://www.reddit.com',
      'wikipedia': 'https://pt.wikipedia.org'
    };

    let targetUrl = siteMap[rawTarget];
    if (!targetUrl) {
      if (rawTarget.includes('.')) {
        targetUrl = rawTarget.startsWith('http') ? rawTarget : `https://${rawTarget}`;
      } else {
        const slug = rawTarget.replace(/\s+/g, '');
        targetUrl = `https://www.${slug}.com.br`;
      }
    }

    return {
      action: 'OPEN_URL',
      label: `abrir ${rawTarget}`,
      confidence: 0.98,
      params: { url: targetUrl },
      probabilities: probs
    };
  }

  // 9. Fallback Inteligente: Termo solto (ex: "como fazer arroz", "nissan gtr 2019")
  probs['pesquisar'] = 0.94;
  probs['abrir site'] = 0.05;

  const isYouTube = activeTab?.url?.includes('youtube.com');
  const isMercadoLivre = activeTab?.url?.includes('mercadolivre.com');

  if (isYouTube || isMercadoLivre) {
    return {
      action: 'SEARCH_ON_PAGE',
      label: `pesquisar "${rawText}" na página`,
      confidence: 0.95,
      params: { query: rawText },
      probabilities: probs
    };
  }

  return {
    action: 'SEARCH_GOOGLE',
    label: `pesquisar "${rawText}" no Google`,
    confidence: 0.94,
    params: { query: rawText },
    probabilities: probs
  };
}

/**
 * Consulta o Backend Local que se comunica com o Jev / TypeSafe AI
 */
async function callJevBackend(text) {
  try {
    // Coleta contexto da aba ativa para enriquecer a decisão do Jev
    let context = {};
    if (chrome.tabs && chrome.tabs.query) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab) {
        context = {
          url: activeTab.url || '',
          title: activeTab.title || ''
        };
      }
    }

    const response = await fetch(`${state.settings.backendUrl}/api/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text, context })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Servidor retornou status ${response.status}`);
    }

    const decision = await response.json();

    // Atualiza modelo e custos com base nos dados do Jev
    if (decision.model) {
      state.model = decision.model;
    }
    if (decision.cost) {
      state.stats.totalCost += decision.cost;
    }
    if (decision.latency) {
      state.stats.lastLatency = decision.latency;
    }

    return decision;
  } catch (err) {
    addLog('⚠️', `Servidor Backend indisponível (${err.message}). Recorrendo ao motor local.`, 'error');
    // Fallback gracioso para o motor local caso o servidor backend não esteja ativo
    return interpretCommandLocally(text);
  }
}

// ==========================================
// Execução de Ações
// ==========================================
async function executeAction(action, params = {}, actionLabel = '') {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'EXECUTE_ACTION',
      payload: { action, params }
    });

    if (response && response.success) {
      state.stats.actions++;
      updateStatsDisplay();
      setDecisionStatus('acted', 'AGIU');
      addLog('✅', response.message || `${actionLabel || action} executado com sucesso.`, 'success');
    } else {
      setDecisionStatus('error', 'FALHA');
      addLog('❌', response?.error || 'Erro ao executar ação.', 'error');
    }
  } catch (err) {
    setDecisionStatus('error', 'ERRO');
    addLog('❌', `Erro de comunicação: ${err.message}`, 'error');
  }
}

// ==========================================
// Atualização Visual de Decisão e Métricas
// ==========================================
function renderDecision(decision) {
  elements.decisionAction.textContent = decision.label || decision.action;
  elements.decisionConfidence.textContent = `${Math.round((decision.confidence || 0) * 100)}%`;

  // Renderiza gráfico de probabilidades
  elements.probabilitiesList.innerHTML = '';
  const probs = decision.probabilities || {};

  const entries = Object.entries(probs).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    elements.probabilitiesList.innerHTML = '<div style="color: #64748B; font-size: 11px;">Sem dados de probabilidade.</div>';
    return;
  }

  for (const [name, score] of entries.slice(0, 4)) {
    const percentage = Math.round(score * 100);
    const row = document.createElement('div');
    row.className = 'prob-row';
    row.innerHTML = `
      <span class="prob-name">${name}</span>
      <div class="prob-bar-track">
        <div class="prob-bar-fill" style="width: ${percentage}%;"></div>
      </div>
      <span class="prob-val">${score.toFixed(2)}</span>
    `;
    elements.probabilitiesList.appendChild(row);
  }
}

function setDecisionStatus(type, text) {
  elements.decisionBadge.className = `badge-status ${type}`;
  elements.decisionBadge.textContent = text;
}

function updateStatsDisplay() {
  elements.statModel.textContent = state.model || 'typesafe/jev';
  elements.statLatency.textContent = `${state.stats.lastLatency} ms`;
  elements.statCalls.textContent = state.stats.calls;
  elements.statActions.textContent = state.stats.actions;
  elements.statCost.textContent = `US$ ${state.stats.totalCost.toFixed(6)}`;
}

// ==========================================
// Log de Ações
// ==========================================
function addLog(icon, text, modifier = '') {
  const emptyMsg = elements.logContainer.querySelector('.log-empty');
  if (emptyMsg) {
    emptyMsg.remove();
  }

  const now = new Date();
  const timeStr = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join(':');

  const logItem = document.createElement('div');
  logItem.className = 'log-item';
  logItem.innerHTML = `
    <span class="log-time">${timeStr}</span>
    <span class="log-icon">${icon}</span>
    <span class="log-text ${modifier}">${escapeHtml(text)}</span>
  `;

  elements.logContainer.appendChild(logItem);
  elements.logContainer.scrollTop = elements.logContainer.scrollHeight;
}

function clearLog() {
  elements.logContainer.innerHTML = '<div class="log-empty">Histórico de ações limpo.</div>';
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

// ==========================================
// Listeners e Eventos
// ==========================================
function setupEventListeners() {
  elements.btnVoiceToggle.addEventListener('click', () => {
    if (state.isListening) {
      stopListening();
    } else {
      startListening();
    }
  });

  elements.btnClearLog.addEventListener('click', clearLog);

  elements.btnSettings.addEventListener('click', () => {
    elements.settingsModal.classList.remove('hidden');
  });

  elements.btnCloseSettings.addEventListener('click', () => {
    elements.settingsModal.classList.add('hidden');
  });

  elements.btnSaveSettings.addEventListener('click', saveSettings);

  // Modo Silencioso: Envio manual de comandos por texto
  if (elements.textCommandForm) {
    elements.textCommandForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = elements.inputCommand.value.trim();
      if (!text) return;
      elements.inputCommand.value = '';
      elements.transcriptionBox.classList.remove('placeholder');
      elements.transcriptionBox.textContent = text;
      handleSpokenText(text);
    });
  }

  // Modo Silencioso: Chips de teste rápido com um clique
  document.querySelectorAll('.quick-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const cmd = chip.getAttribute('data-cmd');
      if (cmd) {
        elements.transcriptionBox.classList.remove('placeholder');
        elements.transcriptionBox.textContent = cmd;
        handleSpokenText(cmd);
      }
    });
  });
}
