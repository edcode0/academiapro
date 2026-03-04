const fs = require('fs');
const path = require('path');

try {
    // 1. ai_tutor.html
    let pAiTutor = path.join(__dirname, 'public', 'ai_tutor.html');
    let aiTutorHtml = fs.readFileSync(pAiTutor, 'utf8');

    const tPromptTeacher = "¡Hola! Soy tu asistente IA de AcademiaPro. Puedo ayudarte a crear ejercicios, planificar sesiones o resolver dudas sobre material didáctico. ¿En qué te ayudo?";
    const repPromptTeacher = "¡Hola! Soy tu asistente pedagógico inteligente de AcademiaPro. Puedo ayudarte a preparar clases, crear ejercicios o sugerir metodologías didácticas. ¿En qué te ayudo hoy?";

    const tPromptStudent = "¡Hola! Soy tu tutor IA especializado en Física y Química. Puedes hacerme preguntas o subir un PDF usando el icono 📎 para que lo analice. ¿Qué estudiamos hoy?";
    const repPromptStudent = "¡Hola! Soy tu asistente educativo inteligente de AcademiaPro. Puedes hacerme preguntas sobre cualquier materia o subir un PDF usando el icono 📎 para que lo analice. ¿Qué estudiamos hoy?";

    aiTutorHtml = aiTutorHtml.replace(tPromptTeacher, repPromptTeacher);
    aiTutorHtml = aiTutorHtml.replace(tPromptStudent, repPromptStudent);

    const tSuggTeacher = 'suggestions = ["Sugiéreme un ejercicio de cinemática", "Explica la termodinámica", "Crea una práctica de laboratorio"];';
    const repSuggTeacher = 'suggestions = ["Ayúdame a planificar una clase", "Dame ideas para un examen", "¿Cómo motivo a mis alumnos?"];';

    const tSuggStudent = 'suggestions = ["¿Qué es la velocidad?", "Explícame los estados de la materia", "¿Cómo resolver ecuaciones?"];';
    const repSuggStudent = 'suggestions = ["Explícame las células", "Ayuda con sintaxis", "¿Cómo resolver ecuaciones?"];';

    aiTutorHtml = aiTutorHtml.replace(tSuggTeacher, repSuggTeacher);
    aiTutorHtml = aiTutorHtml.replace(tSuggStudent, repSuggStudent);

    fs.writeFileSync(pAiTutor, aiTutorHtml);

    // 2. login.html
    let pLogin = path.join(__dirname, 'public', 'login.html');
    let loginHtml = fs.readFileSync(pLogin, 'utf8');
    const tSlide = 'Inteligencia artificial especializada en Física y Química adaptada';
    const rSlide = 'Inteligencia artificial adaptada a cualquier materia y';
    loginHtml = loginHtml.replace(tSlide, rSlide);

    // Remove globalLoading
    loginHtml = loginHtml.replace(/<div class="loading-overlay" id="globalLoading">[\s\S]*?<p id="loadingText">Cargando\.\.\.<\/p>\s*<\/div>/, '');

    // Add client validation code
    const validationScript = `
        document.getElementById('login-form').addEventListener('submit', function(e) {
            const roleSelected = document.querySelector('.role-btn.selected');
            if (roleSelected && !roleSelected.classList.contains('role-admin')) {
                const codeGroup = document.getElementById('academy-code-group');
                const codeInput = document.getElementById('academy_code');
                if (codeGroup && codeGroup.style.display !== 'none') {
                    if (!codeInput.value.trim()) {
                        e.preventDefault();
                        if(!document.getElementById('code-err-msg')) {
                            const err = document.createElement('div');
                            err.id = 'code-err-msg';
                            err.style.color = '#ef4444';
                            err.style.fontSize = '0.8rem';
                            err.style.marginTop = '0.2rem';
                            err.textContent = 'El código de academia es obligatorio';
                            codeGroup.appendChild(err);
                        }
                    } else {
                        const err = document.getElementById('code-err-msg');
                        if (err) err.remove();
                    }
                }
            }
        });
`;
    if (!loginHtml.includes("code-err-msg")) {
        loginHtml = loginHtml.replace('// Focus email input', validationScript + '\n            // Focus email input');
    }
    fs.writeFileSync(pLogin, loginHtml);

    // 3. Header Academy name
    const filesWithHeader = ['index.html', 'teacher_dashboard.html', 'student_portal.html'];
    filesWithHeader.forEach(f => {
        let p = path.join(__dirname, 'public', f);
        let html = fs.readFileSync(p, 'utf8');

        const rHeader = '<div>\n                <h2 id="welcomeText" style="margin-bottom:0.2rem;">¡Hola</h2>\n                <p class="academy-name">🏫 <span id="academyNameDisplay">...</span></p>\n            </div>';
        const rStudentHeader = '<div>\n                <h2 id="student-welcome" style="margin-bottom:0.2rem;">¡Hola</h2>\n                <p class="academy-name">🏫 <span id="academyNameDisplay">...</span></p>\n            </div>';

        if (f !== 'student_portal.html' && html.includes('<h2 id="welcomeText">¡Hola')) {
            html = html.replace(/<h2 id="welcomeText">¡Hola(.*?)<\/h2>/, rHeader.replace('¡Hola', '¡Hola$1') + '           ');
        } else if (f === 'student_portal.html' && html.includes('<h2 id="student-welcome">¡Hola')) {
            html = html.replace(/<h2 id="student-welcome">¡Hola(.*?)<\/h2>/, rStudentHeader.replace('¡Hola', '¡Hola$1') + '           ');
        }

        if (!html.includes('.academy-name {')) {
            const css = `.academy-name { font-size: 1rem; color: #6366f1; font-weight: 600; margin-top: 4px; }`;
            html = html.replace('</style>', `    ${css}\n    </style>`);
        }

        const rInitAdmin = "document.getElementById('academyNameDisplay').textContent = user.academy_name || 'AcademiaPro';\n            document.getElementById('welcome-title')";
        const rInitTeacher = "document.getElementById('academyNameDisplay').textContent = user.academy_name || 'AcademiaPro';\n            document.getElementById('welcomeText')";
        const rInitStudent = "document.getElementById('academyNameDisplay').textContent = student.academy_name || 'AcademiaPro';\n                document.getElementById('student-welcome')";

        if (f === 'index.html' && !html.includes('academyNameDisplay')) {
            html = html.replace("document.getElementById('welcome-title')", rInitAdmin);
        } else if (f === 'teacher_dashboard.html' && !html.includes('academyNameDisplay')) {
            html = html.replace("document.getElementById('welcomeText')", rInitTeacher);
        } else if (f === 'student_portal.html' && !html.includes('academyNameDisplay')) {
            html = html.replace("document.getElementById('student-welcome')", rInitStudent);
        }

        fs.writeFileSync(p, html);
    });

    // 4. index.js
    let pIndex = path.join(__dirname, 'index.js');
    let indexJs = fs.readFileSync(pIndex, 'utf8');

    const tAuthMeSql = `SELECT u.id, u.email, u.role, u.academy_id, u.user_code, 
               COALESCE(s.name, u.name) as name
        FROM users u
        LEFT JOIN students s ON u.id = s.user_id
        WHERE u.id = $1`;
    const rAuthMeSql = `SELECT u.id, u.email, u.role, u.academy_id, u.user_code, 
               COALESCE(s.name, u.name) as name, a.name as academy_name
        FROM users u
        LEFT JOIN students s ON u.id = s.user_id
        LEFT JOIN academies a ON u.academy_id = a.id
        WHERE u.id = $1`;
    if (indexJs.includes(tAuthMeSql)) {
        indexJs = indexJs.replace(tAuthMeSql, rAuthMeSql);
    }

    if (!indexJs.includes('a.name as academy_name FROM students s JOIN academies a ON s.academy_id = a.id')) {
        indexJs = indexJs.replace('db.query(\'SELECT * FROM students WHERE user_id = $1\', [req.user.id]', 'db.query("SELECT s.*, a.name as academy_name FROM students s JOIN academies a ON s.academy_id = a.id WHERE s.user_id = $1", [req.user.id]');
    }

    const tEndpoint = `app.post('/api/exam-simulator/generate', authenticateJWT, requireStudent, async (req, res) => {
    try {
        const { topic, difficulty, numQuestions, course } = req.body;
        const prompt = \`Genera un examen de \${topic} para \${course} con \${numQuestions} preguntas de nivel \${difficulty}.`;

    const rEndpoint = `app.post('/api/exam-simulator/generate', authenticateJWT, requireStudent, async (req, res) => {
    try {
        const { topic, difficulty, numQuestions, course, type, pdfContext } = req.body;
        let typeInstruction = "Todas las preguntas deben ser tipo test (multiple_choice).";
        if (type === 'mix') typeInstruction = "La mitad de las preguntas deben ser tipo test (multiple_choice) y la otra mitad de desarrollo (open).";
        if (type === 'open') typeInstruction = "Todas las preguntas deben ser de desarrollo (open) e incluir la respuesta completa.";
        if (type === 'math') typeInstruction = "Todas las preguntas deben ser problemas matemáticos que requieran solución paso a paso (open).";

        let contextInstruction = pdfContext ? \`\\nGenera el examen basándote principalmente en este material:\\n\${pdfContext}\\n\` : "";

        const prompt = \`Genera un examen de \${topic} para \${course} con \${numQuestions} preguntas de nivel \${difficulty}.
        \${typeInstruction} \${contextInstruction}`;

    if (indexJs.includes('const { topic, difficulty, numQuestions, course } = req.body;')) {
        indexJs = indexJs.replace(tEndpoint, rEndpoint);
    }
    fs.writeFileSync(pIndex, indexJs);

    // 5. exam_simulator.html
    let pSimulator = path.join(__dirname, 'public', 'exam_simulator.html');
    let simHtml = fs.readFileSync(pSimulator, 'utf8');

    const additionalUI = `
                <div class="form-group">
                    <label>📄 Añadir contexto (opcional)</label>
                    <div id="pdf-drop-zone" style="border: 2px dashed var(--border); border-radius: 0.5rem; padding: 2rem; text-align: center; cursor: pointer; background: white; transition: background 0.2s;">
                        <span id="pdf-drop-text" style="color: var(--text-muted);">Arrastra un PDF aquí o haz clic para seleccionar</span>
                        <input type="file" id="configPdf" accept="application/pdf" style="display: none;">
                    </div>
                    <div id="pdf-loading" style="display: none; font-size: 0.85rem; color: var(--secondary); margin-top: 0.5rem;">Cargando documento...</div>
                    <div id="pdf-success" style="display: none; font-size: 0.85rem; color: var(--success); margin-top: 0.5rem;">✅ Contexto cargado: <span id="pdf-name"></span></div>
                    <textarea id="configPdfText" style="display: none;"></textarea>
                </div>

                <div class="form-group">
                    <label>Tipo de preguntas</label>
                    <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem;">
                        <label style="display: flex; align-items: center; gap: 0.5rem; font-weight: 400; cursor: pointer;"><input type="radio" name="configType" value="test" checked> 📝 Solo tipo test (multiple choice)</label>
                        <label style="display: flex; align-items: center; gap: 0.5rem; font-weight: 400; cursor: pointer;"><input type="radio" name="configType" value="mix"> 📊 Mitad test, mitad desarrollo</label>
                        <label style="display: flex; align-items: center; gap: 0.5rem; font-weight: 400; cursor: pointer;"><input type="radio" name="configType" value="open"> ✏️ Solo desarrollo/problemas</label>
                        <label style="display: flex; align-items: center; gap: 0.5rem; font-weight: 400; cursor: pointer;"><input type="radio" name="configType" value="math"> 🔢 Problemas matemáticos</label>
                    </div>
                </div>
`;

    if (!simHtml.includes('configPdf')) {
        simHtml = simHtml.replace('<div class="form-group">\n                    <label>Curso / Nivel</label>', additionalUI + '                <div class="form-group">\n                    <label>Curso / Nivel</label>');
    }

    const tDiff = `<option value="fácil">Fácil (Conceptos básicos)</option>
                        <option value="normal" selected>Normal (Nivel de examen estándar)</option>
                        <option value="difícil">Difícil (Reto avanzado)</option>`;
    const rDiff = `<option value="fácil">Fácil</option>
                        <option value="normal" selected>Normal</option>
                        <option value="difícil">Difícil</option>
                        <option value="selectividad" >Selectividad</option>`;
    if (simHtml.includes('<option value="difícil">Difícil (Reto avanzado)</option>')) {
        simHtml = simHtml.replace(tDiff, rDiff);
    }

    const tPayload = 'body: JSON.stringify({ topic, course, difficulty: diff, numQuestions: parseInt(num) })';
    const rPayload = 'body: JSON.stringify({ topic, course, difficulty: diff, numQuestions: parseInt(num), type: document.querySelector(\'input[name="configType"]:checked\').value, pdfContext: document.getElementById(\'configPdfText\').value })';
    if (simHtml.includes(tPayload)) {
        simHtml = simHtml.replace(tPayload, rPayload);
    }

    const scriptsSimulator = `
        const dropZone = document.getElementById('pdf-drop-zone');
        if (dropZone) {
            dropZone.onclick = () => document.getElementById('configPdf').click();
            dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.backgroundColor = '#eff6ff'; };
            dropZone.ondragleave = (e) => { e.preventDefault(); dropZone.style.backgroundColor = 'white'; };
            dropZone.ondrop = (e) => {
                e.preventDefault(); dropZone.style.backgroundColor = 'white';
                if (e.dataTransfer.files.length) handlePdf(e.dataTransfer.files[0]);
            };
            document.getElementById('configPdf').onchange = (e) => {
                if (e.target.files.length) handlePdf(e.target.files[0]);
            };
        }
        async function handlePdf(file) {
            if (file.type !== 'application/pdf') { alert('Solo PDF.'); return; }
            document.getElementById('pdf-loading').style.display = 'block';
            document.getElementById('pdf-success').style.display = 'none';
            const fd = new FormData(); fd.append('pdf', file);
            try {
                const res = await fetch('/api/ai-tutor/extract-pdf', { method: 'POST', body: fd });
                const data = await res.json();
                document.getElementById('pdf-loading').style.display = 'none';
                if (res.ok) {
                    document.getElementById('configPdfText').value = data.text;
                    document.getElementById('pdf-name').textContent = file.name;
                    document.getElementById('pdf-success').style.display = 'block';
                } else alert(data.error);
            } catch(e) { document.getElementById('pdf-loading').style.display = 'none'; alert('Error'); }
        }
`;
    if (!simHtml.includes('handlePdf')) {
        simHtml = simHtml.replace('// Helpers', scriptsSimulator + '\n        // Helpers');
    }

    fs.writeFileSync(pSimulator, simHtml);
    console.log("All fixes applied successfully!");
} catch (e) {
    console.error(e);
}
