const fs = require('fs');
const path = require('path');

let indexJs = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

const newRoutes = `
// TRANSCRIPTS API
app.get('/admin/transcripts', authenticateJWT, requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public/transcripts.html')));
app.get('/teacher/transcripts', authenticateJWT, requireTeacher, (req, res) => res.sendFile(path.join(__dirname, 'public/transcripts.html')));

app.get('/api/transcripts/students', authenticateJWT, (req, res) => {
    let q = 'SELECT s.id, s.name FROM students s WHERE s.academy_id = $1';
    let params = [req.user.academy_id];
    
    if (req.user.role === 'teacher') {
        q += ' AND s.assigned_teacher_id = $2';
        params.push(req.user.id);
    }
    q += ' ORDER BY s.name ASC';
    db.query(q, params, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows || []);
    });
});

app.post('/api/transcripts/process', authenticateJWT, pdfUpload.single('file'), async (req, res) => {
    try {
        const { student_id } = req.body;
        let transcript_text = req.body.transcript_text || '';

        if (req.file) {
            const ext = path.extname(req.file.originalname).toLowerCase();
            if (ext === '.pdf') {
                const pdfParse = require('pdf-parse');
                const data = await pdfParse(req.file.buffer);
                transcript_text = data.text;
            } else if (ext === '.docx') {
                try {
                    const mammoth = require('mammoth');
                    const data = await mammoth.extractRawText({buffer: req.file.buffer});
                    transcript_text = data.value;
                } catch (e) {
                    console.error('Error mammoth:', e);
                    return res.status(400).json({error: 'Error procesando .docx. Asegúrate de que el documento es válido.'});
                }
            } else if (ext === '.txt') {
                transcript_text = req.file.buffer.toString('utf8');
            } else {
                return res.status(400).json({error: 'Formato no soportado (.pdf, .docx, .txt)'});
            }
        }

        if (!student_id || !transcript_text || transcript_text.trim().length < 10) {
            return res.status(400).json({error: 'Se requiere ID de alumno y un texto válido de la clase (mín. 10 caracteres).'});
        }

        const prompt = \`Analiza esta transcripción de clase y genera un resumen estructurado. 
Responde en JSON con este formato exacto (sin Markdown extra):
{
  "resumen": "Resumen breve de la clase en 2-3 frases",
  "conceptos_clave": ["concepto 1", "concepto 2"],
  "deberes": ["tarea 1", "tarea 2"],
  "pistas_profesor": ["pista o consejo 1", "pista 2"],
  "proximos_pasos": ["paso 1", "paso 2"],
  "mensaje_motivador": "Mensaje corto de ánimo personalizado para el alumno"
}

Transcripción:
\${transcript_text}\`;

        const apiResponse = await groqClient.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: 'system', content: 'Eres un asistente educativo que analiza transcripciones de clases particulares. Tu tarea es extraer la información más útil para el alumno. Responde EXCLUSIVAMENTE con el JSON solicitado.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.3,
            response_format: { type: "json_object" }
        });

        let jsonContent;
        try {
            jsonContent = JSON.parse(apiResponse.choices[0].message.content);
        } catch(e) {
            console.error('JSON Parse error', e, apiResponse.choices[0].message.content);
            return res.status(500).json({error: 'La IA no devolvió un JSON válido.'});
        }

        // Save History - raw_text subset
        const isPostgres = !!process.env.DATABASE_URL;
        const insertSql = isPostgres
            ? 'INSERT INTO transcripts (academy_id, teacher_id, student_id, raw_text, processed_json) VALUES ($1, $2, $3, $4, $5)'
            : 'INSERT INTO transcripts (academy_id, teacher_id, student_id, raw_text, processed_json) VALUES ($1, $2, $3, $4, $5)';
            
        db.query(insertSql, [req.user.academy_id, req.user.role === 'teacher' ? req.user.id : null, student_id, transcript_text.substring(0, 5000), JSON.stringify(jsonContent)]);

        res.json(jsonContent);
    } catch (err) {
        console.error('Transcript error:', err);
        res.status(500).json({ error: 'Error procesando la transcripción', details: err.message });
    }
});

app.post('/api/transcripts/send-to-chat', authenticateJWT, async (req, res) => {
    try {
        const { student_id, processed_json } = req.body;
        db.query('SELECT user_id FROM students WHERE id = $1 AND academy_id = $2', [student_id, req.user.academy_id], (err, studRes) => {
            if (err || !studRes.rows || !studRes.rows[0]) return res.status(404).json({error: 'Student not found or has no user account'});
            const studentUserId = studRes.rows[0].user_id;
            
            if (!studentUserId) return res.status(400).json({error: 'El alumno no tiene cuenta de usuario activa.'});

            const { resumen, conceptos_clave, deberes, pistas_profesor, proximos_pasos, mensaje_motivador } = processed_json;
            const messageStr = \`📚 *Resumen de tu clase de hoy*

\${resumen || ''}

📝 *Deberes para casa:*
\${(deberes || []).map(d => '• ' + d).join('\\n')}

💡 *Conceptos importantes:*
\${(conceptos_clave || []).map(c => '• ' + c).join('\\n')}

🎯 *Consejos de tu profe:*
\${(pistas_profesor || []).map(p => '• ' + p).join('\\n')}

🚀 *Próximos pasos:*
\${(proximos_pasos || []).map((p,i) => (i+1) + '. ' + p).join('\\n')}

💪 \${mensaje_motivador || ''}\`;

            const sqlFindRoom = \`
                SELECT r.id FROM rooms r
                JOIN room_members rm1 ON r.id = rm1.room_id AND rm1.user_id = $1
                JOIN room_members rm2 ON r.id = rm2.room_id AND rm2.user_id = $2
                WHERE r.type = 'direct'
            \`;
            
            db.query(sqlFindRoom, [req.user.id, studentUserId], async (err, roomRes) => {
                if (err) return res.status(500).json({ error: err.message });
                let roomId = roomRes.rows && roomRes.rows.length ? roomRes.rows[0].id : null;
                
                const isPostgres = !!process.env.DATABASE_URL;
                const processMessage = (rId) => {
                    const insertMsgSql = isPostgres 
                        ? 'INSERT INTO messages (room_id, sender_id, content, academy_id) VALUES ($1, $2, $3, $4) RETURNING *'
                        : 'INSERT INTO messages (room_id, sender_id, content, academy_id) VALUES ($1, $2, $3, $4)';
                        
                    db.query(insertMsgSql, [rId, req.user.id, messageStr, req.user.academy_id], (err, resInsert) => {
                        const messageId = isPostgres && resInsert.rows ? resInsert.rows[0].id : resInsert.lastID;
                        
                        // Emit via socket
                        db.query('SELECT name, role FROM users WHERE id = $1', [req.user.id], (err, nameRes) => {
                            const senderRow = nameRes.rows ? nameRes.rows[0] : null;
                            if (senderRow) {
                                io.to(\`room_\${rId}\`).emit('new_message', {
                                    id: messageId,
                                    room_id: rId,
                                    sender_id: req.user.id,
                                    content: messageStr,
                                    sender_name: senderRow.name,
                                    sender_role: senderRow.role,
                                    created_at: new Date().toISOString()
                                });
                            }
                        });
                        
                        return res.json({success: true});
                    });
                };

                if (roomId) {
                    processMessage(roomId);
                } else {
                    const insertRoomSql = isPostgres 
                        ? "INSERT INTO rooms (academy_id, type) VALUES ($1, 'direct') RETURNING id"
                        : "INSERT INTO rooms (academy_id, type) VALUES ($1, 'direct')";
                        
                    db.query(insertRoomSql, [req.user.academy_id], (err, newR) => {
                        const newId = isPostgres && newR.rows ? newR.rows[0].id : newR.lastID;
                        db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [newId, req.user.id], () => {
                            db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [newId, studentUserId], () => {
                                processMessage(newId);
                            });
                        });
                    });
                }
            });
        });
    } catch(err) { res.status(500).json({error: err.message}); }
});

app.get('/api/transcripts/history', authenticateJWT, (req, res) => {
    let q = \`
        SELECT t.id, t.created_at, t.processed_json, s.name as student_name
        FROM transcripts t
        JOIN students s ON t.student_id = s.id
        WHERE t.academy_id = $1
    \`;
    let params = [req.user.academy_id];
    if (req.user.role === 'teacher') {
        q += ' AND t.teacher_id = $2';
        params.push(req.user.id);
    }
    q += ' ORDER BY t.created_at DESC LIMIT 50';

    db.query(q, params, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows || []);
    });
});
`;

if (!indexJs.includes('/api/transcripts/process')) {
    indexJs = indexJs.replace('// Add express static for other files', newRoutes + '\n// Add express static for other files');
    fs.writeFileSync(path.join(__dirname, 'index.js'), indexJs);
    console.log("Transcripts routes added!");
} else {
    console.log("Transcripts routes already existed!");
}
