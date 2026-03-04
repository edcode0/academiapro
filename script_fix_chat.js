const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'chat.html');
let html = fs.readFileSync(filePath, 'utf8');

const regexRender = /function renderMessageFile[\s\S]*?function renderMessages[^{]*\{[\s\S]*?area\.scrollTop = area\.scrollHeight;\s*\}/;

const newRender = `function renderMessage(msg) {
    const isMine = msg.sender_id === currentUser.id;
    let fileHTML = '';
    
    if (msg.file_url) {
        if (msg.file_type && msg.file_type.startsWith('image/')) {
            fileHTML = \`<img src="\${msg.file_url}" style="max-width:200px;border-radius:8px;margin-top:4px;display:block;">\`;
        } else if (msg.file_type === 'application/pdf') {
            fileHTML = \`<a href="\${msg.file_url}" target="_blank" style="display:flex;align-items:center;gap:6px;background:rgba(99,102,241,0.1);padding:8px 12px;border-radius:8px;margin-top:4px;text-decoration:none;color:#6366f1;">📄 \${msg.file_name} <span style="font-size:0.8em">Abrir PDF</span></a>\`;
        } else {
            fileHTML = \`<a href="\${msg.file_url}" target="_blank" style="display:flex;align-items:center;gap:6px;background:rgba(99,102,241,0.1);padding:8px 12px;border-radius:8px;margin-top:4px;text-decoration:none;color:#6366f1;">📎 \${msg.file_name}</a>\`;
        }
    }
    
    return \`<div class="msg \${isMine ? 'sent' : 'received'}" data-id="\${msg.id}">
        <div class="bubble">
            \${msg.content ? \`<div>\${msg.content}</div>\` : ''}
            \${fileHTML}
        </div>
        <div class="msg-info">
            \${!isMine && activeRoom && activeRoom.type === 'group' ? \`<span>\${msg.sender_name}</span>\` : ''}
            <span class="time">\${new Date(msg.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
    </div>\`;
}

function renderMessages(messages) {
    const area = document.getElementById('messages-area');
    area.innerHTML = messages.map(msg => renderMessage(msg)).join('');
    area.scrollTop = area.scrollHeight;
}`;

html = html.replace(regexRender, newRender);

const regexSend = /async function sendMessage\(\) \{[\s\S]*?clearFileSelection\(\);\s*\}/;

const newSend = `async function sendMessage() {
    const input = document.getElementById('msg-input');
    const txt = input.value.trim();
    if (!txt && !pendingFile) return;

    let file_url = null;
    let file_name = null;
    let file_type = null;

    if (pendingFile) {
        const formData = new FormData();
        formData.append('file', pendingFile);
        try {
            const sendBtn = document.getElementById('send-btn');
            sendBtn.style.opacity = '0.5';
            sendBtn.style.pointerEvents = 'none';

            function getToken() {
                const m = document.cookie.match(/token=([^;]+)/);
                return m ? m[1] : '';
            }

            const res = await fetch('/api/chat/upload-file', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken() },
                body: formData
            });

            if (!res.ok) {
                const errData = await res.json();
                alert('Error subiendo archivo: ' + (errData.error || res.statusText));
                throw new Error('Upload error');
            }
            const dat = await res.json();
            file_url = dat.file_url;
            file_name = dat.file_name;
            file_type = dat.file_type;
        } catch (err) {
            console.error('Error uploading file', err);
            const sendBtn = document.getElementById('send-btn');
            sendBtn.style.opacity = '1';
            sendBtn.style.pointerEvents = 'auto';
            return;
        } finally {
            const sendBtn = document.getElementById('send-btn');
            sendBtn.style.opacity = '1';
            sendBtn.style.pointerEvents = 'auto';
        }
    }

    const tempId = 'temp_' + Date.now();
    const messageData = {
        academy_id: currentUser.academy_id,
        room_id: activeRoom.id,
        sender_id: currentUser.id,
        content: txt,
        file_url: file_url,
        file_name: file_name,
        file_type: file_type,
        id: tempId,
        created_at: new Date().toISOString(),
        sender_name: currentUser.name
    };

    const area = document.getElementById('messages-area');
    area.insertAdjacentHTML('beforeend', renderMessage(messageData));
    area.scrollTop = area.scrollHeight;

    socket.emit('sendMessage', messageData);
    input.value = '';
    clearFileSelection();
}`;

html = html.replace(regexSend, newSend);

const regexSocket = /socket\.on\('new_message', \(msg\) => \{[\s\S]*?\}\);/;

const newSocket = `socket.on('new_message', (msg) => {
    if (activeRoom && activeRoom.id === msg.room_id) {
        const area = document.getElementById('messages-area');
        
        // Find existing temp message
        const isMatched = Array.from(area.querySelectorAll('.msg')).find(el => {
            const dataId = el.getAttribute('data-id');
            if (dataId && dataId.startsWith('temp_')) {
                const contentEl = el.querySelector('.bubble div');
                const htmlContent = contentEl ? contentEl.textContent.trim() : '';
                const msgContent = msg.content ? msg.content.trim() : '';
                if (htmlContent === msgContent) return true;
                if (!msgContent && msg.file_url && el.innerHTML.includes(msg.file_name || 'Archivo')) return true;
            }
            return false;
        });

        if (isMatched) {
            isMatched.setAttribute('data-id', msg.id);
        } else {
            const duplicate = area.querySelector(\`.msg[data-id="\${msg.id}"]\`);
            if (!duplicate) {
                area.insertAdjacentHTML('beforeend', renderMessage(msg));
                area.scrollTop = area.scrollHeight;
            }
        }
    } else {
        updateTotalUnread();
    }
    loadRooms();
});`;

html = html.replace(regexSocket, newSocket);

fs.writeFileSync(filePath, html, 'utf8');
console.log('Successfully updated chat.html');
