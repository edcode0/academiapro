const fs = require('fs');
let out = '';
function p(str) { out += str + '\n'; }

async function run() {
    p("## 1. CHAT SYSTEM");
    const lines = fs.readFileSync('index.js', 'utf8').split('\n');
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
        if (/(socket|io|chat|messages|rooms)/.test(lines[i]) && /app\./.test(lines[i])) {
            p(`${i + 1}:${lines[i]}`);
            count++;
            if (count >= 20) break;
        }
    }

    p("\n- Socket.io initialization code in index.js:");
    lines.forEach((l, i) => { if (l.includes("require('socket.io')")) p(`${i+1}:${l}`); });

    p("\n- Chat message sending endpoint:");
    lines.forEach((l, i) => { if (l.includes("app.post('/api/chat") || l.includes('app.post("/api/chat')) p(`${i+1}:${l}`); });

    p("\n- Chat messages fetch endpoint:");
    lines.forEach((l, i) => { if (l.includes("app.get('/api/chat/messages") || l.includes('app.get("/api/chat/messages')) p(`${i+1}:${l}`); });

    p("\n## 2. AI TUTOR HISTORY");
    p("\n- GET endpoint that fetches AI tutor chat history:");
    lines.forEach((l, i) => { if (l.includes("app.get('/api/ai-tutor/history") || l.includes('app.get("/api/ai-tutor/history')) p(`${i+1}:${l}`); });

    p("\n- INSERT INTO related to tutor/chat/messages table:");
    lines.forEach((l, i) => { if (l.includes("INSERT INTO chat_messages") || (l.includes("INSERT INTO ") && l.includes("ai-tutor"))) p(`${i+1}:${l}`); });

    
    const dbjs = fs.readFileSync('db.js', 'utf8');
    p("\n- Run: SELECT column_name FROM information_schema.columns WHERE table_name = 'messages'");
    const msgDef = dbjs.match(/CREATE TABLE IF NOT EXISTS messages.*?\(.*?\)/s);
    if(msgDef) p(msgDef[0]);

    p("\n- Run: SELECT column_name FROM information_schema.columns WHERE table_name = 'chat_messages'");
    const cmsgDef = dbjs.match(/CREATE TABLE IF NOT EXISTS chat_messages.*?\(.*?\)/s);
    if(cmsgDef) p(cmsgDef[0]); else p("Table chat_messages not found in db.js!");
    
    p("\n## 3. Check tables exist");
    p("\n- Run: SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    const tablesMatches = dbjs.match(/CREATE TABLE IF NOT EXISTS [\w_]+/g);
    if(tablesMatches) p(tablesMatches.map(t => t.split(' ').pop()).join('\n'));

    p("\nFINISHED");
    fs.writeFileSync('diag_result.txt', out, 'utf8');
    process.exit(0);
}

run();
