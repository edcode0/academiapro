const fs = require('fs');
const path = 'public/ai_tutor.html';
let html = fs.readFileSync(path, 'utf8');

const regex = /async function sendMessage\(\)[ \s\S]*?\}(?=\s*async function loadSuggestions)/;

const replacement = `
        function showTypingIndicator() {
            document.getElementById('typingIndicator').style.display = 'flex';
            document.getElementById('sendBtn').disabled = true;
        }

        function hideTypingIndicator() {
            document.getElementById('typingIndicator').style.display = 'none';
            document.getElementById('sendBtn').disabled = false;
        }

        async function sendWithPDF(file, userMessage) {
            showTypingIndicator();
            try {
                const formData = new FormData();
                formData.append('pdf', file);
                
                const extractRes = await fetch('/api/ai-tutor/extract-pdf', {
                    method: 'POST',
                    body: formData
                });
                
                const extractData = await extractRes.json();
                
                if (!extractRes.ok) {
                    hideTypingIndicator();
                    messagesContext.push({ role: 'assistant', content: '❌ ' + (extractData.error || 'Error al leer el PDF'), timestamp: new Date().toISOString() });
                    renderMessages();
                    return;
                }
                
                const pdfContext = \`El usuario ha compartido un PDF llamado "\${file.name}" (\${extractData.pages} páginas).\\n\\nContenido del PDF:\\n\${extractData.text}\`;
                const fullMessage = userMessage 
                    ? \`\${pdfContext}\\n\\nPregunta del usuario: \${userMessage}\`
                    : \`\${pdfContext}\\n\\nPor favor, resume el contenido de este documento.\`;
                
                const displayMessage = \`📄 \${file.name}\${userMessage ? '\\n' + userMessage : ''}\`;
                
                await sendToGroq(fullMessage, displayMessage);
                
            } catch (err) {
                hideTypingIndicator();
                messagesContext.push({ role: 'assistant', content: '❌ Error al procesar el PDF. Inténtalo de nuevo.', timestamp: new Date().toISOString() });
                renderMessages();
                console.error('PDF error:', err);
            }
        }

        async function sendToGroq(apiMessage, displayMessage = null) {
            if (!displayMessage) displayMessage = apiMessage;

            if (!currentConversationId) {
                const titleText = displayMessage || 'Análisis de PDF';
                const res = await fetch('/api/ai/conversations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: titleText.substring(0, 50) + (titleText.length > 50 ? '...' : '') })
                });
                const data = await res.json();
                currentConversationId = data.id;
                document.getElementById('current-chat-title').textContent = titleText.substring(0, 50);
            }

            await fetch(\`/api/ai/conversations/\${currentConversationId}/messages\`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: 'user', content: displayMessage })
            });

            messagesContext.push({ role: 'user', content: displayMessage, timestamp: new Date().toISOString() });
            renderMessages();
            loadConversations();

            showTypingIndicator();

            try {
                const apiPayload = messagesContext.map((m, index) => ({
                    role: m.role,
                    content: (index === messagesContext.length - 1 && m.role === 'user') ? apiMessage : m.content
                }));
                
                const res = await fetch('/api/ai-tutor/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messages: apiPayload })
                });

                if (res.ok) {
                    const data = await res.json();
                    const aiContent = data.response;

                    await fetch(\`/api/ai/conversations/\${currentConversationId}/messages\`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ role: 'assistant', content: aiContent })
                    });

                    messagesContext.push({ role: 'assistant', content: aiContent, timestamp: new Date().toISOString() });
                    renderMessages();
                    loadConversations();
                } else {
                    const errorMsg = "❌ Error al procesar el mensaje. Inténtalo de nuevo.";
                    messagesContext.push({ role: 'assistant', content: errorMsg, timestamp: new Date().toISOString(), isError: true });
                    renderMessages();
                }
            } catch (err) {
                console.error(err);
                messagesContext.push({ role: 'assistant', content: "❌ Error grave de conexión. Verifica tu internet y vuelve a intentarlo.", timestamp: new Date().toISOString(), isError: true });
                renderMessages();
            } finally {
                hideTypingIndicator();
            }
        }

        async function sendMessage() {
            const input = document.getElementById('messageInput');
            const content = input.value.trim();
            if (!content && !currentPdfFile) return;

            const fileToPass = currentPdfFile;
            
            input.value = '';
            input.style.height = '40px';
            document.getElementById('suggestionsBox').style.display = 'none';

            clearPdfAttachment();

            if (fileToPass) {
                await sendWithPDF(fileToPass, content);
            } else {
                await sendToGroq(content);
            }
        }`;

html = html.replace(regex, replacement.trim());
fs.writeFileSync(path, html, 'utf8');
console.log('Fixed sendMessage safely in', path);
