const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');
const files = fs.readdirSync(publicDir);

const blobsHtml = `
    <!-- BG Blobs -->
    <div class="bg-blobs">
        <div class="blob blob-1"></div>
        <div class="blob blob-2"></div>
        <div class="blob blob-3"></div>
    </div>
`;

files.forEach(file => {
    if (file.endsWith('.html')) {
        const filePath = path.join(publicDir, file);
        let content = fs.readFileSync(filePath, 'utf8');

        // Include CSS
        if (!content.includes('glassmorphism.css')) {
            content = content.replace('</head>', '    <link rel="stylesheet" href="/glassmorphism.css">\n</head>');
        }

        // Include blobs
        if (!content.includes('bg-blobs')) {
            content = content.replace(/<body[^>]*>/, `$&${blobsHtml}`);
        }

        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated ${file}`);
    }
});
