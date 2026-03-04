const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'chat.html');
let html = fs.readFileSync(filePath, 'utf8');

// 1. Add getAuthToken and auth
const authTarget = `<script>
        const socket = io();
        let currentUser = null;`;
const authReplace = `<script>
        function getAuthToken() {
            const cookie = document.cookie.split(';').find(c => c.trim().startsWith('token='));
            if (cookie) return cookie.split('=')[1];
            return localStorage.getItem('token') || '';
        }

        const socket = io();
        socket.on('connect', () => {
            const token = getAuthToken();
            socket.emit('authenticate', token);
        });

        let currentUser = null;`;

html = html.replace(authTarget, authReplace);

// 2. Update selectRoom
const fetchTarget = `            renderRooms(allRooms);
            const res = await fetch(\`/api/chat/messages/\${room.id}\`);
            const messages = await res.json();
            renderMessages(messages);

            await fetch(\`/api/chat/mark-read/\${room.id}\`, { method: 'POST' });`;

const fetchReplace = `            renderRooms(allRooms);
            const token = getAuthToken();
            socket.emit('join_room', room.id);
            const res = await fetch(\`/api/chat/rooms/\${room.id}/messages\`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const messages = await res.json();
            renderMessages(messages);

            await fetch(\`/api/chat/mark-read/\${room.id}\`, { 
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token }
            });`;

html = html.replace(fetchTarget, fetchReplace);

// 3. Update get token logic in sendMessage
const getTokenTarget = `function getToken() {
                const m = document.cookie.match(/token=([^;]+)/);
                return m ? m[1] : '';
            }`;

const getTokenReplace = `function getToken() {
                return getAuthToken();
            }`;

html = html.replace(getTokenTarget, getTokenReplace);

// 4. Update sendMessage token passing inside sendMessage (wait, upload-file uses headers implicitly)
// Everything else is fine.

fs.writeFileSync(filePath, html, 'utf8');
console.log('Successfully updated chat.html again');
