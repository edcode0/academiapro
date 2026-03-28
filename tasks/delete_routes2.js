'use strict';
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'index.js');
const lines = fs.readFileSync(filePath, 'utf8').split('\n');

// Ranges to delete (1-indexed, inclusive)
// Block 1: // ─── Gmail OAuth endpoints ... // ─────...
// Line 1544 to 1673
// Block 2: // TRANSCRIPTS API ... }); (close of /api/transcripts/history)
// Line 1675 to 1943

const removeRanges = [
    [1544, 1673],
    [1675, 1943],
];

// Mark lines for removal (0-indexed)
const toRemove = new Set();
for (const [start, end] of removeRanges) {
    for (let i = start - 1; i <= end - 1; i++) {
        toRemove.add(i);
    }
}

const newLines = lines.filter((_, i) => !toRemove.has(i));
fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');

console.log('Done. Removed', toRemove.size, 'lines.');
console.log('New line count:', newLines.length, 'vs original:', lines.length);
