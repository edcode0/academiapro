'use strict';
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'index.js');
let lines = fs.readFileSync(filePath, 'utf8').split('\n');

console.log('Original line count:', lines.length);

// Step 1: Find exact line numbers for each change
const lineNumbers = {};
lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed === "const { createNotification, setIo: setNotifIo } = require('./notifications');") {
        lineNumbers.notifLine = i; // 0-indexed
    }
    if (trimmed === 'app.use(passport.session());') {
        lineNumbers.passportLine = i; // 0-indexed
    }
    if (trimmed === "// ─── Gmail OAuth endpoints ────────────────────────────────────────────────────") {
        lineNumbers.gmailOAuthComment = i; // 0-indexed
    }
    if (trimmed === "// ─────────────────────────────────────────────────────────────────────────────" && lineNumbers.checkTranscriptsEnd === undefined && i > 1600) {
        lineNumbers.checkTranscriptsEnd = i; // 0-indexed (the separator after check-transcripts)
    }
    if (trimmed === "// TRANSCRIPTS API") {
        lineNumbers.transcriptsApiComment = i; // 0-indexed
    }
});

// Find end of /api/transcripts/history route (the }); right before // Add express static)
let transcriptsHistoryEnd = -1;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "// Add express static for other files (must be AFTER root and routes)") {
        // Walk back to find the last }); before this
        for (let j = i - 1; j >= 0; j--) {
            if (lines[j].trim() === '});') {
                transcriptsHistoryEnd = j; // 0-indexed
                break;
            }
        }
        break;
    }
}

console.log('Line indices found:');
console.log('  notifLine:', lineNumbers.notifLine);
console.log('  passportLine:', lineNumbers.passportLine);
console.log('  gmailOAuthComment:', lineNumbers.gmailOAuthComment);
console.log('  checkTranscriptsEnd:', lineNumbers.checkTranscriptsEnd);
console.log('  transcriptsApiComment:', lineNumbers.transcriptsApiComment);
console.log('  transcriptsHistoryEnd:', transcriptsHistoryEnd);

// Verify all found
const required = ['notifLine', 'passportLine', 'gmailOAuthComment', 'checkTranscriptsEnd', 'transcriptsApiComment'];
for (const k of required) {
    if (lineNumbers[k] === undefined) {
        console.error('ERROR: could not find', k);
        process.exit(1);
    }
}
if (transcriptsHistoryEnd === -1) {
    console.error('ERROR: could not find transcriptsHistoryEnd');
    process.exit(1);
}

// Step 2: Mark lines to remove
// Range 1: gmailOAuthComment through checkTranscriptsEnd (inclusive)
// Range 2: transcriptsApiComment through transcriptsHistoryEnd (inclusive)
const toRemove = new Set();
for (let i = lineNumbers.gmailOAuthComment; i <= lineNumbers.checkTranscriptsEnd; i++) {
    toRemove.add(i);
}
for (let i = lineNumbers.transcriptsApiComment; i <= transcriptsHistoryEnd; i++) {
    toRemove.add(i);
}
console.log('Lines to remove:', toRemove.size);

// Step 3: Build new lines array with insertions
const newLines = [];
for (let i = 0; i < lines.length; i++) {
    if (toRemove.has(i)) continue;

    newLines.push(lines[i]);

    // After notifLine, add the transcriptsRouter require
    if (i === lineNumbers.notifLine) {
        newLines.push("const transcriptsRouter = require('./routes/transcripts')(io);");
    }

    // After passportLine, add the app.use(transcriptsRouter)
    if (i === lineNumbers.passportLine) {
        newLines.push('app.use(transcriptsRouter);');
    }
}

console.log('New line count:', newLines.length, 'vs original:', lines.length);
console.log('Expected reduction:', toRemove.size, 'removed, 2 added = net', toRemove.size - 2, 'less');

fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
console.log('Done. File written.');
