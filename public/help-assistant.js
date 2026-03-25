(function() {
  // Inject styles
  const style = document.createElement('style');
  style.textContent = `
    #help-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 9998;
      width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: white; font-size: 24px; box-shadow: 0 4px 20px rgba(99,102,241,0.4);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s;
    }
    #help-btn:hover { transform: scale(1.1); }
    #help-panel {
      position: fixed; bottom: 90px; right: 24px; z-index: 9997;
      width: 360px; height: 480px; background: white; border-radius: 16px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.15); display: none; flex-direction: column;
      overflow: hidden; border: 1px solid #e5e7eb;
    }
    #help-panel.open { display: flex; }
    #help-header {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: white; padding: 16px; display: flex; align-items: center; justify-content: space-between;
      font-weight: 600; font-size: 14px;
    }
    #help-close { background: none; border: none; color: white; font-size: 20px; cursor: pointer; padding: 0; line-height: 1; }
    #help-messages {
      flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px;
      background: #f9fafb;
    }
    .help-msg { max-width: 80%; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.5; }
    .help-msg.user { background: #6366f1; color: white; align-self: flex-end; border-bottom-right-radius: 4px; }
    .help-msg.assistant { background: white; color: #1f2937; align-self: flex-start; border-bottom-left-radius: 4px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
    #help-input-row { padding: 12px; display: flex; gap: 8px; border-top: 1px solid #e5e7eb; background: white; }
    #help-input {
      flex: 1; border: 1px solid #d1d5db; border-radius: 8px; padding: 8px 12px;
      font-size: 13px; outline: none; resize: none;
    }
    #help-input:focus { border-color: #6366f1; }
    #help-send {
      background: #6366f1; color: white; border: none; border-radius: 8px;
      padding: 8px 14px; cursor: pointer; font-size: 13px; font-weight: 600;
      transition: background 0.2s;
    }
    #help-send:hover { background: #4f46e5; }
    #help-send:disabled { background: #9ca3af; cursor: not-allowed; }
  `;
  document.head.appendChild(style);

  // Inject button
  const btn = document.createElement('button');
  btn.id = 'help-btn';
  btn.innerHTML = '💬';
  btn.title = 'Asistente de ayuda';
  document.body.appendChild(btn);

  // Inject panel
  const panel = document.createElement('div');
  panel.id = 'help-panel';
  panel.innerHTML = `
    <div id="help-header">
      <span>🤖 Asistente AcademiaPro</span>
      <button id="help-close">×</button>
    </div>
    <div id="help-messages">
      <div class="help-msg assistant">¡Hola! Soy tu asistente de AcademiaPro. ¿En qué puedo ayudarte?</div>
    </div>
    <div id="help-input-row">
      <textarea id="help-input" placeholder="Escribe tu pregunta..." rows="1"></textarea>
      <button id="help-send">Enviar</button>
    </div>
  `;
  document.body.appendChild(panel);

  let conversationHistory = [];

  btn.addEventListener('click', () => panel.classList.toggle('open'));
  document.getElementById('help-close').addEventListener('click', () => panel.classList.remove('open'));

  const messagesDiv = document.getElementById('help-messages');
  const input = document.getElementById('help-input');
  const sendBtn = document.getElementById('help-send');

  function addMessage(role, text) {
    const div = document.createElement('div');
    div.className = `help-msg ${role}`;
    div.textContent = text;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  async function sendMessage() {
    const msg = input.value.trim();
    if (!msg) return;
    addMessage('user', msg);
    conversationHistory.push({ role: 'user', content: msg });
    input.value = '';
    sendBtn.disabled = true;
    sendBtn.textContent = '...';

    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/help-assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ message: msg, conversationHistory: conversationHistory.slice(-10) })
      });
      const data = await res.json();
      const reply = data.response || 'Lo siento, no pude procesar tu pregunta.';
      addMessage('assistant', reply);
      conversationHistory.push({ role: 'assistant', content: reply });
    } catch (e) {
      addMessage('assistant', 'Error de conexión. Inténtalo de nuevo.');
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Enviar';
    }
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
})();
