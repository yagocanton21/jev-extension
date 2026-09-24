/**
 * Jev Voice - Permission Request Handler
 * Solicita e armazena permissão de microfone para a origem da extensão no Chrome.
 */

document.getElementById('btnGrant').addEventListener('click', async () => {
  const statusEl = document.getElementById('statusText');
  const btn = document.getElementById('btnGrant');

  try {
    statusEl.textContent = 'Solicitando permissão ao navegador...';
    btn.disabled = true;

    // Dispara o prompt nativo de permissão do Chrome na aba
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Encerra a stream imediatamente, pois o objetivo é apenas registrar a permissão na origem da extensão
    stream.getTracks().forEach(track => track.stop());

    statusEl.textContent = '✅ Microfone autorizado com sucesso! Fechando...';
    statusEl.className = 'status success';

    // Notifica o Side Panel que a permissão foi concedida
    if (chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'MIC_PERMISSION_GRANTED' }).catch(() => {});
    }

    // Fecha a guia de autorização automaticamente após 1 segundo
    setTimeout(() => {
      window.close();
    }, 1000);
  } catch (err) {
    console.error('Erro ao obter microfone:', err);
    btn.disabled = false;
    statusEl.textContent = `❌ Permissão negada ou falhou: ${err.message}. Clique novamente e selecione "Permitir".`;
    statusEl.style.color = '#FF3B30';
  }
});
