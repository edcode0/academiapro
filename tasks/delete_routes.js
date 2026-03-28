'use strict';
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'index.js');
let content = fs.readFileSync(filePath, 'utf8');

// We want to remove from:
//   app.get('/api/gmail/callback', async (req, res) => {
// to (and including):
//   });  <- close of /api/transcripts/history
//
// Followed by:
//   \n// Add express static for other files

const START = "app.get('/api/gmail/callback', async (req, res) => {";
const END_SENTINEL = "// Add express static for other files";

const startIdx = content.indexOf(START);
if (startIdx === -1) {
    console.log('ERROR: start marker not found');
    process.exit(1);
}

const endIdx = content.indexOf(END_SENTINEL);
if (endIdx === -1) {
    console.log('ERROR: end sentinel not found');
    process.exit(1);
}

// We want to keep the END_SENTINEL and everything after
// We want to remove from startIdx to endIdx (exclusive)
// But we should also trim the blank lines before END_SENTINEL that came from the removed block

// Find the last newline before END_SENTINEL to figure out what's between
const between = content.substring(startIdx, endIdx);
console.log('Characters to remove:', between.length);
console.log('First 100 chars of removed:', JSON.stringify(between.substring(0, 100)));
console.log('Last 100 chars of removed:', JSON.stringify(between.substring(between.length - 100)));

// Build new content: before START + after the removed block
const before = content.substring(0, startIdx).trimEnd() + '\n\n';
const after = content.substring(endIdx);

const newContent = before + after;
fs.writeFileSync(filePath, newContent, 'utf8');
console.log('Done. File written.');
