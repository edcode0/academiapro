const fs = require('fs');
const path = require('path');

let indexJs = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

const targetStr = `app.post('/api/admin/add-user-by-code', authenticateJWT, requireAdmin, (req, res) => {
    const { code, role } = req.body;
    db.query('SELECT * FROM users WHERE user_code = $1', [code], (err, result) => {
        const user = result?.rows[0];
        if (err || !user) return res.status(404).json({ error: 'Código no encontrado' });

        const acadId = req.user.academy_id;

        db.query('UPDATE users SET role = $1, academy_id = $2 WHERE id = $3', [role, acadId, user.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });

            if (role === 'student') {
                db.query('SELECT id FROM students WHERE user_id = $1 AND academy_id = $2', [user.id, acadId], (err, resMatch) => {
                    const existing = resMatch?.rows[0];
                    if (!existing) {
                        db.query('INSERT INTO students (name, parent_email, academy_id, user_id, join_date) VALUES ($1, $2, $3, $4, $5)',
                            [user.name, user.email, acadId, user.id, new Date().toISOString().split('T')[0]]);
                    }
                });

                db.query('INSERT INTO rooms (academy_id, type) VALUES ($1, "direct")', [acadId], (err, resRoom) => {
                    if (!err) {
                        const roomId = resRoom.lastID;
                        db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, user.id]);
                        db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, req.user.id]);
                    }
                });
            } else if (role === 'teacher') {
                db.query('INSERT INTO rooms (academy_id, type) VALUES ($1, "direct")', [acadId], (err, resRoom) => {
                    if (!err) {
                        const roomId = resRoom.lastID;
                        db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, user.id]);
                        db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, req.user.id]);
                    }
                });
                db.query('SELECT id FROM rooms WHERE academy_id = $1 AND type = "group" AND name = "General Profesores"', [acadId], (err, resGroup) => {
                    const room = resGroup?.rows[0];
                    if (room) {
                        db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [room.id, user.id]);
                    }
                });
            }
            res.json({ success: true, name: user.name, role });
        });
    });
});`;

const replacement = `app.post('/api/admin/add-user-by-code', authenticateJWT, requireAdmin, async (req, res) => {
    const { code, role } = req.body;
    try {
        let result = await db.query('SELECT * FROM users WHERE user_code = $1', [code]);
        const user = result?.rows && result.rows.length ? result.rows[0] : null;
        if (!user) return res.status(404).json({ error: 'Código no encontrado' });

        const acadId = req.user.academy_id;

        await db.query('UPDATE users SET role = $1, academy_id = $2 WHERE id = $3', [role, acadId, user.id]);

        if (role === 'student') {
            let resMatch = await db.query('SELECT id FROM students WHERE user_id = $1 AND academy_id = $2', [user.id, acadId]);
            const existing = resMatch?.rows && resMatch.rows.length ? resMatch.rows[0] : null;
            if (!existing) {
                await db.query('INSERT INTO students (name, parent_email, academy_id, user_id, join_date) VALUES ($1, $2, $3, $4, $5)',
                    [user.name, user.email, acadId, user.id, new Date().toISOString().split('T')[0]]);
            }
        }
        
        await ensureRooms(acadId);
        res.json({ success: true, name: user.name, role });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});`;

if (indexJs.includes(targetStr)) {
    indexJs = indexJs.replace(targetStr, replacement);
    fs.writeFileSync(path.join(__dirname, 'index.js'), indexJs);
    console.log("Replaced successfully!");
} else {
    // try to regex replace
    indexJs = indexJs.replace(/app\.post\('\/api\/admin\/add-user-by-code'[\s\S]*?(?=\napp\.post\('\/api\/students')/, replacement);
    fs.writeFileSync(path.join(__dirname, 'index.js'), indexJs);
    console.log("Replaced via regex!");
}
