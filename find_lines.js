const fs = require('fs');
const lines = fs.readFileSync('index.js', 'utf8').split('\n');
const results = [];
for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/(socket|io|chat|messages|rooms)/.test(line) && /app\./.test(line)) {
        results.push(`${i + 1}:${line}`);
    }
}
console.log(results.slice(0, 20).join('\n'));
