/**
 * Injects favicon <link> tags into all public HTML files.
 * Inserts after the first <meta charset...> line found in each file.
 */
const fs   = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');

const FAVICON_TAGS = `  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`;

const files = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));
let patched = 0, skipped = 0;

for (const file of files) {
  const filePath = path.join(publicDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Skip if already patched
  if (content.includes('/favicon.svg')) {
    console.log(`  SKIP (already has favicon): ${file}`);
    skipped++;
    continue;
  }

  // Find insertion point: end of the line containing <meta charset
  const charsetMatch = content.match(/<meta\s+charset[^>]*>/i);
  if (!charsetMatch) {
    console.log(`  WARN (no charset meta found): ${file}`);
    skipped++;
    continue;
  }

  const insertAfter = charsetMatch.index + charsetMatch[0].length;
  // Find the newline after the charset line
  const nlPos = content.indexOf('\n', insertAfter);
  const insertPos = nlPos !== -1 ? nlPos + 1 : insertAfter + 1;

  content = content.slice(0, insertPos) + FAVICON_TAGS + '\n' + content.slice(insertPos);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`  PATCHED: ${file}`);
  patched++;
}

console.log(`\nDone. Patched: ${patched}, Skipped: ${skipped}`);
