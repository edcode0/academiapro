const fs = require('fs');

let content = fs.readFileSync('index.js', 'utf8');

// The search regex properly matching role = "teacher" or "admin" or "student"
content = content.replace(/role\s*=\s*"teacher"/g, "role = 'teacher'");
content = content.replace(/role\s*=\s*"student"/g, "role = 'student'");
content = content.replace(/role\s*=\s*"admin"/g, "role = 'admin'");

fs.writeFileSync('index.js', content, 'utf8');
console.log('Patch complete.');
