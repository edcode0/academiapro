const fs = require('fs');
const path = require('path');

let indexJs = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

const ensureRoomsCode = `
async function ensureRooms(academyId) {
    let created = 0;
    let existing = 0;
    const isPostgres = !!process.env.DATABASE_URL;
    
    // 1. Ensure "General Profesores" exists
    let groupRes = await db.query("SELECT id FROM rooms WHERE academy_id = $1 AND type = 'group' AND name = 'General Profesores'", [academyId]);
    if (!groupRes.rows || groupRes.rows.length === 0) {
        let insertSql = isPostgres 
            ? "INSERT INTO rooms (academy_id, type, name) VALUES ($1, 'group', 'General Profesores') RETURNING id"
            : "INSERT INTO rooms (academy_id, type, name) VALUES ($1, 'group', 'General Profesores')";
            
        let newRoom = await db.query(insertSql, [academyId]);
        let newId = isPostgres && newRoom.rows ? newRoom.rows[0].id : newRoom.lastID;
        created++;
        
        let usersRes = await db.query("SELECT id FROM users WHERE academy_id = $1 AND role IN ('admin', 'teacher')", [academyId]);
        for (let u of (usersRes.rows || [])) {
            await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [newId, u.id]);
        }
    } else {
        existing++;
        // Make sure all teachers and admin are in the room just in case
        let gId = groupRes.rows[0].id;
        let usersRes = await db.query("SELECT id FROM users WHERE academy_id = $1 AND role IN ('admin', 'teacher')", [academyId]);
        let memRes = await db.query("SELECT user_id FROM room_members WHERE room_id = $1", [gId]);
        let mems = (memRes.rows || []).map(m => m.user_id);
        for (let u of (usersRes.rows || [])) {
            if (!mems.includes(u.id)) {
                await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [gId, u.id]);
            }
        }
    }

    // Get all students with their assigned teachers
    let studentsRes = await db.query('SELECT s.user_id as student_user_id, s.assigned_teacher_id FROM students s WHERE s.academy_id = $1 AND s.user_id IS NOT NULL', [academyId]);
    const students = studentsRes.rows || [];

    // Get admin
    let adminRes = await db.query("SELECT id FROM users WHERE academy_id = $1 AND role = 'admin'", [academyId]);
    const adminId = adminRes.rows && adminRes.rows.length ? adminRes.rows[0].id : null;

    if (!adminId) return { created, existing };

    async function ensureDirectRoom(u1, u2) {
        if (!u1 || !u2) return;
        let directRes = await db.query(\`
            SELECT r.id FROM rooms r
            JOIN room_members rm1 ON r.id = rm1.room_id AND rm1.user_id = $1
            JOIN room_members rm2 ON r.id = rm2.room_id AND rm2.user_id = $2
            WHERE r.type = 'direct'
        \`, [u1, u2]);

        if (!directRes.rows || directRes.rows.length === 0) {
            const insertRoomSql = isPostgres 
                ? "INSERT INTO rooms (academy_id, type) VALUES ($1, 'direct') RETURNING id"
                : "INSERT INTO rooms (academy_id, type) VALUES ($1, 'direct')";
                
            let newR = await db.query(insertRoomSql, [academyId]);
            let newId = isPostgres && newR.rows ? newR.rows[0].id : newR.lastID;
            await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [newId, u1]);
            await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [newId, u2]);
            created++;
        } else {
            existing++;
        }
    }

    for (let s of students) {
        await ensureDirectRoom(adminId, s.student_user_id);
        if (s.assigned_teacher_id) {
            await ensureDirectRoom(s.assigned_teacher_id, s.student_user_id);
        }
    }

    // Admin <-> Teachers
    let teachersRes = await db.query("SELECT id FROM users WHERE academy_id = $1 AND role = 'teacher'", [academyId]);
    for(let t of (teachersRes.rows || [])) {
        await ensureDirectRoom(adminId, t.id);
    }

    return { created, existing };
}

app.post('/api/chat/ensure-rooms', authenticateJWT, async (req, res) => {
    try {
        const result = await ensureRooms(req.user.academy_id);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/chat/debug-rooms', authenticateJWT, requireAdmin, async (req, res) => {
    try {
        let sql = \`
            SELECT r.id, r.type, r.name,
                   (SELECT GROUP_CONCAT(u.name, ', ') FROM room_members rm JOIN users u ON rm.user_id = u.id WHERE rm.room_id = r.id) as members
            FROM rooms r
            WHERE r.academy_id = $1
        \`;
        if (!!process.env.DATABASE_URL) {
            sql = \`
                SELECT r.id, r.type, r.name,
                       (SELECT STRING_AGG(u.name, ', ') FROM room_members rm JOIN users u ON rm.user_id = u.id WHERE rm.room_id = r.id) as members
                FROM rooms r
                WHERE r.academy_id = $1
            \`;
        }
        let result = await db.query(sql, [req.user.academy_id]);
        res.json(result.rows || []);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
`;

if (!indexJs.includes('/api/chat/ensure-rooms')) {
    indexJs = indexJs.replace('// Chat API - New Rooms Logic', ensureRoomsCode + '\n// Chat API - New Rooms Logic');
}

// Fix /api/admin/students/:id/teacher
// Find the endpoint
indexJs = indexJs.replace(/app\.put\('\/api\/admin\/students\/:id\/teacher'[\s\S]*?(?=\n\/\/ CRUD Generic)/, `
// CHANGE student's teacher
app.put('/api/admin/students/:id/teacher', authenticateJWT, requireAdmin, async (req, res) => {
    const assigned_teacher_id = req.body.assigned_teacher_id || null;
    try {
        let row = await db.query('SELECT user_id, name FROM students WHERE id = $1 AND academy_id = $2', [req.params.id, req.user.academy_id]);
        const student = row?.rows && row.rows.length ? row.rows[0] : null;
        if (!student) return res.status(404).json({ error: 'Student not found' });

        await db.query('UPDATE students SET assigned_teacher_id = $1 WHERE id = $2', [assigned_teacher_id, req.params.id]);
        await ensureRooms(req.user.academy_id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
`);


const targetSendToChat = `app.post('/api/transcripts/send-to-chat', authenticateJWT, async (req, res) => {
    try {
        const { student_id, processed_json } = req.body;
        db.query('SELECT user_id FROM students WHERE id = $1 AND academy_id = $2', [student_id, req.user.academy_id], (err, studRes) => {
            if (err || !studRes.rows || !studRes.rows[0]) return res.status(404).json({error: 'Student not found or has no user account'});
            const studentUserId = studRes.rows[0].user_id;
            
            if (!studentUserId) return res.status(400).json({error: 'El alumno no tiene cuenta de usuario activa.'});

            const { resumen, conceptos_clave, deberes, pistas_profesor, proximos_pasos, mensaje_motivador } = processed_json;
            const messageStr = \`\\📚 *Resumen de tu clase de hoy*

\${resumen || ''}

📝 *Deberes para casa:*
\${(deberes || []).map(d => '• ' + d).join('\\\\n')}

💡 *Conceptos importantes:*
\${(conceptos_clave || []).map(c => '• ' + c).join('\\\\n')}

🎯 *Consejos de tu profe:*
\${(pistas_profesor || []).map(p => '• ' + p).join('\\\\n')}

🚀 *Próximos pasos:*
\${(proximos_pasos || []).map((p,i) => (i+1) + '. ' + p).join('\\\\n')}

💪 \${mensaje_motivador || ''}\`;

            const sqlFindRoom = \`\\
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
});`;

// Try to use regex to replace send-to-chat
indexJs = indexJs.replace(/app\.post\('\/api\/transcripts\/send-to-chat'[\s\S]*?(?=\napp\.get\('\/api\/transcripts\/history')/, `
app.post('/api/transcripts/send-to-chat', authenticateJWT, async (req, res) => {
    try {
        const { student_id, processed_json } = req.body;
        const studRes = await db.query('SELECT user_id FROM students WHERE id = $1 AND academy_id = $2', [student_id, req.user.academy_id]);
        if (!studRes.rows || !studRes.rows[0]) return res.status(404).json({error: 'Student not found or has no user account'});
        const studentUserId = studRes.rows[0].user_id;
        if (!studentUserId) return res.status(400).json({error: 'El alumno no tiene cuenta de usuario activa.'});

        // Ensure rooms first to guarantee direct room exists
        await ensureRooms(req.user.academy_id);

        const { resumen, conceptos_clave, deberes, pistas_profesor, proximos_pasos, mensaje_motivador } = processed_json;
        const messageStr = \`📚 *Resumen de tu clase de hoy*\\n\\n\${resumen || ''}\\n\\n📝 *Deberes para casa:*\\n\${(deberes || []).map(d => '• ' + d).join('\\n')}\\n\\n💡 *Conceptos importantes:*\\n\${(conceptos_clave || []).map(c => '• ' + c).join('\\n')}\\n\\n🎯 *Consejos de tu profe:*\\n\${(pistas_profesor || []).map(p => '• ' + p).join('\\n')}\\n\\n🚀 *Próximos pasos:*\\n\${(proximos_pasos || []).map((p,i) => (i+1) + '. ' + p).join('\\n')}\\n\\n💪 \${mensaje_motivador || ''}\`;

        const sqlFindRoom = \`
            SELECT r.id FROM rooms r
            JOIN room_members rm1 ON r.id = rm1.room_id AND rm1.user_id = $1
            JOIN room_members rm2 ON r.id = rm2.room_id AND rm2.user_id = $2
            WHERE r.type = 'direct'
        \`;
        
        let roomRes = await db.query(sqlFindRoom, [req.user.id, studentUserId]);
        let roomId = roomRes.rows && roomRes.rows.length ? roomRes.rows[0].id : null;

        const isPostgres = !!process.env.DATABASE_URL;
        if (!roomId) {
            // Should not happen since we just ensureRooms, but just in case
            const insertRoomSql = isPostgres 
                ? "INSERT INTO rooms (academy_id, type) VALUES ($1, 'direct') RETURNING id"
                : "INSERT INTO rooms (academy_id, type) VALUES ($1, 'direct')";
            let newR = await db.query(insertRoomSql, [req.user.academy_id]);
            roomId = isPostgres && newR.rows ? newR.rows[0].id : newR.lastID;
            await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, req.user.id]);
            await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, studentUserId]);
        }

        const insertMsgSql = isPostgres 
            ? 'INSERT INTO messages (room_id, sender_id, content, academy_id) VALUES ($1, $2, $3, $4) RETURNING *'
            : 'INSERT INTO messages (room_id, sender_id, content, academy_id) VALUES ($1, $2, $3, $4)';
        let resInsert = await db.query(insertMsgSql, [roomId, req.user.id, messageStr, req.user.academy_id]);
        const messageId = isPostgres && resInsert.rows ? resInsert.rows[0].id : resInsert.lastID;

        // Emit via socket
        let nameRes = await db.query('SELECT name, role FROM users WHERE id = $1', [req.user.id]);
        const senderRow = nameRes.rows ? nameRes.rows[0] : null;
        if (senderRow) {
            io.to(\`room_\${roomId}\`).emit('new_message', {
                id: messageId,
                room_id: roomId,
                sender_id: req.user.id,
                content: messageStr,
                sender_name: senderRow.name,
                sender_role: senderRow.role,
                created_at: new Date().toISOString()
            });
        }
        
        return res.json({success: true, room_id: roomId});
    } catch(err) { 
        res.status(500).json({error: err.message}); 
    }
});`);

// Run ensureRooms on DB init
if (!indexJs.includes("await ensureRooms(acad.id)")) {
    indexJs = indexJs.replace(/db\.initDb\(\)\.then\(\(\) => \{([\s\S]*?)server\.listen/, `db.initDb().then(async () => {
    // Ensure all rooms exist on startup
    try {
        let acRes = await db.query('SELECT id FROM academies');
        for (let acad of (acRes.rows || [])) {
            await ensureRooms(acad.id);
        }
        console.log("Chat rooms ensured for all academies.");
    } catch (e) { console.error("Error ensuring rooms:", e.message); }
    $1server.listen`);
}

fs.writeFileSync(path.join(__dirname, 'index.js'), indexJs);
console.log("Rooms logic patched.");
