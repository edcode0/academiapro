'use strict';

const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const passport = require('passport');
const { Resend } = require('resend');
const db       = require('../db');
const { authenticateJWT } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET;

// ─── Email helpers ────────────────────────────────────────────────────────────
async function sendWelcomeEmail(user, academyName) {
    try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
            from: 'AcademiaPro <no-reply@academiapro.academy>',
            to: user.email,
            subject: '¡Bienvenido a AcademiaPro! 🎓',
            html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Inter,sans-serif;background:#f8fafc;margin:0;padding:0}.container{max-width:600px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)}.header{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:40px;text-align:center}.header h1{color:white;margin:0;font-size:28px}.header p{color:rgba(255,255,255,.85);margin:8px 0 0}.body{padding:40px}.body h2{color:#1e293b;font-size:22px}.body p{color:#64748b;line-height:1.6}.steps{background:#f8fafc;border-radius:12px;padding:24px;margin:24px 0}.step{display:flex;align-items:flex-start;margin-bottom:16px}.step-num{background:#6366f1;color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0;margin-right:12px;margin-top:2px}.step-text{color:#374151}.step-text strong{color:#1e293b;display:block;margin-bottom:2px}.btn{display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;font-size:16px;margin:8px 0}.footer{background:#f8fafc;padding:24px 40px;text-align:center}.footer p{color:#94a3b8;font-size:13px;margin:0}</style></head><body><div class="container"><div class="header"><h1>🎓 AcademiaPro</h1><p>La plataforma inteligente para academias</p></div><div class="body"><h2>¡Hola, ${user.name}! 👋</h2><p>Tu academia <strong>${academyName || 'AcademiaPro'}</strong> ya está creada y lista para usar. Aquí tienes los primeros pasos para empezar:</p><div class="steps"><div class="step"><div class="step-num">1</div><div class="step-text"><strong>Comparte los códigos de tu academia</strong>Ve a Configuración y copia los códigos para profesores y alumnos</div></div><div class="step"><div class="step-num">2</div><div class="step-text"><strong>Añade tus primeros alumnos</strong>Desde el panel de Estudiantes puedes crear fichas individuales</div></div><div class="step"><div class="step-num">3</div><div class="step-text"><strong>Invita a tus profesores</strong>Comparte el código de profesor para que se unan a tu academia</div></div><div class="step"><div class="step-num">4</div><div class="step-text"><strong>Prueba el Tutor IA</strong>El asistente inteligente está disponible para profesores y alumnos</div></div></div><div style="text-align:center;margin:32px 0"><a href="${process.env.BASE_URL || 'https://web-production-d02f4.up.railway.app'}" class="btn">Ir a mi academia →</a></div><p style="font-size:14px;color:#94a3b8;text-align:center">¿Tienes alguna duda? Responde a este email y te ayudamos.</p></div><div class="footer"><p>AcademiaPro · La plataforma inteligente para academias de repaso</p></div></div></body></html>`
        });
        console.log('[Email] Welcome email sent to user id:', user.id);
    } catch (err) {
        console.error('[Email] Welcome email error:', err.message);
    }
}

async function sendJoinWelcomeEmail(user, academyName, role) {
    try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const roleText = role === 'teacher' ? 'profesor' : 'alumno';
        const dashboardUrl = role === 'teacher' ? '/teacher' : '/student-portal';
        await resend.emails.send({
            from: 'AcademiaPro <no-reply@academiapro.academy>',
            to: user.email,
            subject: `✅ Te has unido a ${academyName} en AcademiaPro`,
            html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Inter,sans-serif;background:#f8fafc;margin:0;padding:20px}.container{max-width:500px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)}.header{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:32px;text-align:center}.header h1{color:white;margin:0;font-size:24px}.body{padding:32px}.body p{color:#64748b;line-height:1.6}.btn{display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:600}.footer{padding:20px 32px;text-align:center;background:#f8fafc}.footer p{color:#94a3b8;font-size:13px;margin:0}</style></head><body><div class="container"><div class="header"><h1>🎓 AcademiaPro</h1></div><div class="body"><h2 style="color:#1e293b">¡Bienvenido, ${user.name}! 👋</h2><p>Te has unido a <strong>${academyName}</strong> como <strong>${roleText}</strong>. Ya puedes acceder a tu panel.</p><div style="text-align:center;margin:24px 0"><a href="${process.env.BASE_URL || 'https://web-production-d02f4.up.railway.app'}${dashboardUrl}" class="btn">Ir a mi panel →</a></div></div><div class="footer"><p>AcademiaPro · La plataforma inteligente para academias</p></div></div></body></html>`
        });
        console.log('[Email] Join welcome email sent to user id:', user.id);
    } catch (err) {
        console.error('[Email] Join welcome email error:', err.message);
    }
}
// ─────────────────────────────────────────────────────────────────────────────

const { generateCode, generateUserCode } = require('../utils/codes');

router.get('/api/auth/check-code/:code', (req, res) => {
    db.query('SELECT name FROM academies WHERE teacher_code = $1 OR student_code = $2', [req.params.code, req.params.code], (err, result) => {
        const acad = result?.rows[0];
        if (acad) res.json({ valid: true, academy_name: acad.name });
        else res.json({ valid: false });
    });
});

router.post('/auth/register', async (req, res) => {
    try {
        const { name, email, password, academy_name, academy_code } = req.body;
        const hash = bcrypt.hashSync(password, 10);
        const userCode = generateUserCode();

        if (academy_code) {
            const result = await db.query('SELECT * FROM academies WHERE teacher_code = $1 OR student_code = $2', [academy_code, academy_code]);
            const acad = result?.rows ? result.rows[0] : (result || [])[0];
            if (!acad) return res.status(404).json({ error: 'Código de academia no válido' });

            const role = academy_code === acad.teacher_code ? 'teacher' : 'student';

            // Check if user already exists
            const userRes = await db.query('SELECT * FROM users WHERE email = $1', [email]);
            const existingUser = userRes?.rows ? userRes.rows[0] : (userRes || [])[0];

            let userId;

            if (existingUser) {
                if (existingUser.academy_id === acad.id) {
                    return res.status(400).json({ error: 'Este email ya está registrado en esta academia' });
                }
                // Update to new academy
                await db.query('UPDATE users SET academy_id = $1, role = $2 WHERE id = $3', [acad.id, role, existingUser.id]);
                userId = existingUser.id;
            } else {
                try {
                    const insertSql = !!process.env.DATABASE_URL
                        ? 'INSERT INTO users (name, email, password_hash, role, academy_id, user_code) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id'
                        : 'INSERT INTO users (name, email, password_hash, role, academy_id, user_code) VALUES ($1, $2, $3, $4, $5, $6)';

                    const resInsert = await db.query(insertSql, [name, email, hash, role, acad.id, userCode]);
                    userId = !!process.env.DATABASE_URL && resInsert.rows ? resInsert.rows[0].id : resInsert.lastID;
                } catch (err) {
                    if (err.message.includes('UNIQUE constraint failed') || err.message.includes('duplicate key value')) {
                        return res.status(400).json({ error: 'Este email ya está registrado. Por favor inicia sesión.' });
                    }
                    throw err;
                }
            }

            if (role === 'student') {
                const resMatch = await db.query('SELECT id FROM students WHERE name = $1 AND academy_id = $2 AND user_id IS NULL', [name, acad.id]);
                const existing = resMatch?.rows ? resMatch.rows[0] : (resMatch || [])[0];
                if (existing) {
                    await db.query('UPDATE students SET user_id = $1 WHERE id = $2', [userId, existing.id]);
                } else {
                    await db.query('INSERT INTO students (name, parent_email, academy_id, user_id, join_date) VALUES ($1, $2, $3, $4, $5)', [name, email, acad.id, userId, new Date().toISOString().split('T')[0]]);
                }
                const insertRoom = !!process.env.DATABASE_URL ? 'INSERT INTO rooms (academy_id, type) VALUES ($1, \'direct\') RETURNING id' : 'INSERT INTO rooms (academy_id, type) VALUES ($1, "direct")';
                try {
                    const resRoom = await db.query(insertRoom, [acad.id]);
                    const roomId = !!process.env.DATABASE_URL && resRoom.rows ? resRoom.rows[0].id : resRoom.lastID;
                    await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, userId]);
                    await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, acad.owner_id]);
                } catch (e) { }
            } else if (role === 'teacher') {
                const insertRoom = !!process.env.DATABASE_URL ? 'INSERT INTO rooms (academy_id, type) VALUES ($1, \'direct\') RETURNING id' : 'INSERT INTO rooms (academy_id, type) VALUES ($1, "direct")';
                try {
                    const resRoom = await db.query(insertRoom, [acad.id]);
                    const roomId = !!process.env.DATABASE_URL && resRoom.rows ? resRoom.rows[0].id : resRoom.lastID;
                    await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, userId]);
                    await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, acad.owner_id]);
                } catch (e) { }

                const resGroup = await db.query("SELECT id FROM rooms WHERE academy_id = $1 AND type = 'group' AND name = '👥 Profesores & Admin'", [acad.id]);
                const room = resGroup?.rows ? resGroup.rows[0] : (resGroup || [])[0];
                if (room) {
                    await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [room.id, userId]);
                }
            }
            res.json({ success: true, redirect: '/login' });
        } else {
            const tCode = generateCode();
            const sCode = generateCode();

            try {
                const res1 = await db.query(
                    !!process.env.DATABASE_URL ? 'INSERT INTO academies (name, teacher_code, student_code) VALUES ($1, $2, $3) RETURNING id' : 'INSERT INTO academies (name, teacher_code, student_code) VALUES ($1, $2, $3)',
                    [academy_name, tCode, sCode]
                );
                const acadId = !!process.env.DATABASE_URL && res1.rows ? res1.rows[0].id : res1.lastID;

                const res2 = await db.query(
                    !!process.env.DATABASE_URL ? 'INSERT INTO users (name, email, password_hash, role, academy_id, user_code) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id' : 'INSERT INTO users (name, email, password_hash, role, academy_id, user_code) VALUES ($1, $2, $3, $4, $5, $6)',
                    [name, email, hash, 'admin', acadId, userCode]
                );
                const userId = !!process.env.DATABASE_URL && res2.rows ? res2.rows[0].id : res2.lastID;

                await db.query('UPDATE academies SET owner_id = $1 WHERE id = $2', [userId, acadId]);

                try {
                    const res3 = await db.query(
                        !!process.env.DATABASE_URL ? "INSERT INTO rooms (academy_id, type, name) VALUES ($1, 'group', '👥 Profesores & Admin') RETURNING id" : "INSERT INTO rooms (academy_id, type, name) VALUES ($1, 'group', '👥 Profesores & Admin')", [acadId]
                    );
                    const roomId = !!process.env.DATABASE_URL && res3.rows ? res3.rows[0].id : res3.lastID;
                    await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, userId]);
                } catch (e) { }

                // Send welcome email (non-blocking)
                sendWelcomeEmail({ name, email }, academy_name);

                res.json({ success: true, teacher_code: tCode, student_code: sCode, redirect: '/login' });
            } catch (err) {
                if (err.message.includes('UNIQUE constraint failed') || err.message.includes('duplicate key value')) {
                    return res.status(400).json({ error: 'Este email ya está registrado. Por favor inicia sesión.' });
                }
                console.error('[Register] Error:', err.message);
                res.status(500).json({ error: 'Error interno del servidor' });
            }
        }
    } catch (e) {
        console.error('[Register] Error:', e.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

router.post('/auth/login', async (req, res) => {
    try {
        const { email, password, role, academy_code } = req.body;

        // Find user
        const result = await db.query(
            'SELECT id, name, email, role, academy_id, user_code, password_hash FROM users WHERE email = $1', [email]
        );
        const user = result.rows?.[0] || result[0];

        if (!user) {
            return res.status(401).json({ error: 'Email o contraseña incorrectos' });
        }

        // Check role matches (if role is explicitly provided in the request)
        if (role && user.role !== role) {
            return res.status(401).json({
                error: `Esta cuenta no es de tipo ${role === 'teacher' ? 'profesor' : role === 'student' ? 'alumno' : 'administrador'}`
            });
        }

        // Validate password
        const hash = user.password_hash;
        if (!hash || typeof hash !== 'string') {
            return res.status(500).json({ error: 'Error de configuración de cuenta (no password hash)' });
        }

        const valid = bcrypt.compareSync(password, hash);
        if (!valid) {
            return res.status(401).json({ error: 'Email o contraseña incorrectos' });
        }

        // Generate token
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, academy_id: user.academy_id, name: user.name, user_code: user.user_code },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'strict' });

        console.log('Login successful: id=%d role=%s', user.id, user.role);
        res.json({
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role, user_code: user.user_code }
        });

    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

router.post('/api/auth/join', async (req, res) => {
    try {
        const { academy_code, name, email, password, role } = req.body;

        if (!academy_code || !name || !email || !password || !role) {
            return res.status(400).json({ error: 'Todos los campos son obligatorios' });
        }

        // Find academy using teacher_code or student_code
        const codeColumn = role === 'teacher' ? 'teacher_code' : 'student_code';
        const academyResult = await db.query(
            `SELECT * FROM academies WHERE UPPER(${codeColumn}) = UPPER($1)`,
            [academy_code.trim()]
        );

        console.log('Looking for teacher_code:', academy_code);
        console.log('Query result:', JSON.stringify(academyResult));
        console.log('Rows:', academyResult.rows || academyResult);

        const academy = academyResult.rows?.[0] || academyResult[0];

        if (!academy) {
            return res.status(404).json({
                error: role === 'teacher'
                    ? 'Código de profesor no válido'
                    : 'Código de alumno no válido'
            });
        }

        // Check if email already exists
        const existingResult = await db.query(
            'SELECT id FROM users WHERE email = $1', [email]
        );
        const existing = existingResult.rows?.[0] || existingResult[0];
        if (existing) {
            return res.status(400).json({
                error: 'Este email ya está registrado. Por favor inicia sesión.'
            });
        }

        // Create user
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query(
            'INSERT INTO users (name, email, password_hash, role, academy_id) VALUES ($1, $2, $3, $4, $5)',
            [name, email, hashedPassword, role, academy.id]
        );

        const newUserResult = await db.query(
            'SELECT id, name, email, role, academy_id, user_code FROM users WHERE email = $1', [email]
        );
        const user = newUserResult.rows?.[0] || newUserResult[0];

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, academy_id: user.academy_id },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        console.log('User joined: id=%d role=%s academy=%d', user.id, user.role, academy.id);

        // If joining as student, ensure a students record exists
        if (role === 'student') {
            const existingStudent = await db.query(
                'SELECT id FROM students WHERE user_id = $1 AND academy_id = $2',
                [user.id, academy.id]
            );
            if (!(existingStudent.rows || []).length) {
                await db.query(
                    'INSERT INTO students (user_id, academy_id, name, status, join_date) VALUES ($1, $2, $3, $4, $5)',
                    [user.id, academy.id, name, 'active', new Date().toISOString().split('T')[0]]
                );
            }
        }

        // Send welcome email (non-blocking)
        sendJoinWelcomeEmail(user, academy.name, role);

        res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'strict' });
        res.json({
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role }
        });

    } catch (err) {
        console.error('Join error:', err.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

router.get('/auth/google', (req, res, next) => {
    if (req.query.academy_code) res.cookie('pending_code', req.query.academy_code, { maxAge: 1000 * 60 * 15 });
    const role = req.query.role;
    if (role && ['admin', 'teacher', 'student'].includes(role)) {
        res.cookie('pending_role', role, { maxAge: 1000 * 60 * 15 });
    }
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), async (req, res) => {
    const profile = req.user;
    const email = profile.emails[0].value;
    const name = profile.displayName;

    try {
        const existingResult = await db.query('SELECT id, name, email, role, academy_id, user_code, google_id FROM users WHERE email = $1', [email]);
        const existingUser = existingResult.rows?.[0];

        if (existingUser) {
            // Existing user — always use their role and academy from the DB, never override
            if (!existingUser.google_id) {
                await db.query('UPDATE users SET google_id = $1 WHERE id = $2', [profile.id, existingUser.id]);
            }
            const token = jwt.sign(
                { id: existingUser.id, email: existingUser.email, role: existingUser.role, academy_id: existingUser.academy_id, name: existingUser.name, user_code: existingUser.user_code },
                JWT_SECRET, { expiresIn: '7d' }
            );
            res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });
            res.cookie('auth_token', token, { httpOnly: false, secure: true, sameSite: 'strict', maxAge: 60000 });
            console.log('Google Auth existing user: id=%d role=%s', existingUser.id, existingUser.role);
            return res.redirect('/auth-success');
        }

        // New user — decide what to do based on selected role
        const pendingCode = req.cookies.pending_code;
        const pendingRole = req.cookies.pending_role;
        res.clearCookie('pending_code');
        res.clearCookie('pending_role');

        // If role is teacher or student, redirect to /join to complete registration
        if (pendingRole === 'teacher' || pendingRole === 'student') {
            const joinUrl = `/join?role=${pendingRole}&email=${encodeURIComponent(email)}&google=true`;
            console.log('Google Auth new %s → redirecting to join: %s', pendingRole, joinUrl);
            return res.redirect(joinUrl);
        }

        // Role is admin (or no role specified) — create account as usual
        let role = 'admin';
        let academyId = null;

        if (pendingCode) {
            const actResult = await db.query('SELECT * FROM academies WHERE teacher_code = $1 OR student_code = $2', [pendingCode, pendingCode]);
            const acad = actResult?.rows ? actResult.rows[0] : (actResult || [])[0];
            if (acad) {
                role = pendingCode === acad.teacher_code ? 'teacher' : 'student';
                academyId = acad.id;
            }
        }

        if (!academyId) {
            const academyName = `${name}'s Academy`;
            const tCode = generateCode();
            const sCode = generateCode();
            const resAcad = await db.query(!!process.env.DATABASE_URL
                ? 'INSERT INTO academies (name, teacher_code, student_code) VALUES ($1, $2, $3) RETURNING id'
                : 'INSERT INTO academies (name, teacher_code, student_code) VALUES ($1, $2, $3)', [academyName, tCode, sCode]);
            academyId = !!process.env.DATABASE_URL && resAcad.rows ? resAcad.rows[0].id : resAcad.lastID;
        }

        const userCode = generateUserCode();
        const resUser = await db.query(!!process.env.DATABASE_URL
            ? 'INSERT INTO users (name, email, google_id, role, academy_id, user_code) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id'
            : 'INSERT INTO users (name, email, google_id, role, academy_id, user_code) VALUES ($1, $2, $3, $4, $5, $6)',
            [name, email, profile.id, role, academyId, userCode]);
        const userId = !!process.env.DATABASE_URL && resUser.rows ? resUser.rows[0].id : resUser.lastID;

        if (role === 'admin') {
            await db.query('UPDATE academies SET owner_id = $1 WHERE id = $2', [userId, academyId]);
        }

        const newUserRes = await db.query('SELECT id, name, email, role, academy_id, user_code FROM users WHERE id = $1', [userId]);
        const newUser = newUserRes.rows?.[0];

        const token = jwt.sign(
            { id: newUser.id, email: newUser.email, role: newUser.role, academy_id: newUser.academy_id, name: newUser.name, user_code: newUser.user_code },
            JWT_SECRET, { expiresIn: '7d' }
        );
        res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.cookie('auth_token', token, { httpOnly: false, secure: true, sameSite: 'strict', maxAge: 60000 });
        console.log('Google Auth new user: id=%d role=%s', newUser.id, newUser.role);
        return res.redirect('/auth-success');

    } catch (err) {
        console.error('Google callback error:', err);
        res.redirect('/login?error=auth_failed');
    }
});

router.get('/auth/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/login');
});

router.get('/auth/me', authenticateJWT, (req, res) => {
    const sql = `
        SELECT u.id, u.email, u.role, u.academy_id, u.user_code,
               COALESCE(s.name, u.name) as name
        FROM users u
        LEFT JOIN students s ON u.id = s.user_id
        WHERE u.id = $1
    `;
    db.query(sql, [req.user.id], (err, result) => {
        if (err || !result.rows[0]) return res.json(req.user);
        const user = result.rows[0];

        // Auto-generate code if missing
        if (!user.user_code) {
            const newCode = '#' + Math.floor(10000 + Math.random() * 90000);
            db.query('UPDATE users SET user_code = $1 WHERE id = $2', [newCode, user.id]);
            user.user_code = newCode;
        }

        res.json(user);
    });
});

router.get('/api/auth/me', authenticateJWT, async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const result = await db.query('SELECT id, name, role, academy_id FROM users WHERE id = $1', [userId]);
        const rows = result.rows || result;
        res.json(rows[0] || {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/api/user/my-code', authenticateJWT, (req, res) => {
    db.query('SELECT user_code FROM users WHERE id = $1', [req.user.id], (err, result) => {
        if (err || !result.rows[0]) return res.json({ user_code: null });
        res.json({ user_code: result.rows[0].user_code });
    });
});

router.put('/api/user/generate-code', authenticateJWT, (req, res) => {
    const newCode = '#' + Math.floor(10000 + Math.random() * 90000);
    db.query('UPDATE users SET user_code = $1 WHERE id = $2', [newCode, req.user.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ user_code: newCode });
    });
});

router.delete('/api/auth/delete-account', authenticateJWT, async (req, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;
        const academyId = req.user.academy_id;

        console.log('Deleting account:', userId, userRole, academyId);

        if (userRole === 'admin' && academyId) {
            // Delete all academy data with proper cascade via subqueries
            try { await db.query('DELETE FROM messages WHERE room_id IN (SELECT id FROM rooms WHERE academy_id = $1)', [academyId]); } catch (e) { console.log('Skip messages:', e.message); }
            try { await db.query('DELETE FROM room_members WHERE room_id IN (SELECT id FROM rooms WHERE academy_id = $1)', [academyId]); } catch (e) { console.log('Skip room_members:', e.message); }
            try { await db.query('DELETE FROM rooms WHERE academy_id = $1', [academyId]); } catch (e) { console.log('Skip rooms:', e.message); }
            try { await db.query('DELETE FROM payments WHERE student_id IN (SELECT id FROM students WHERE academy_id = $1)', [academyId]); } catch (e) { console.log('Skip payments:', e.message); }
            try { await db.query('DELETE FROM exams WHERE student_id IN (SELECT id FROM students WHERE academy_id = $1)', [academyId]); } catch (e) { console.log('Skip exams:', e.message); }
            try { await db.query('DELETE FROM sessions WHERE student_id IN (SELECT id FROM students WHERE academy_id = $1)', [academyId]); } catch (e) { console.log('Skip sessions:', e.message); }
            try { await db.query('DELETE FROM students WHERE academy_id = $1', [academyId]); } catch (e) { console.log('Skip students:', e.message); }
            try { await db.query('DELETE FROM users WHERE academy_id = $1', [academyId]); } catch (e) { console.log('Skip users:', e.message); }
            // Delete academy
            try {
                await db.query('DELETE FROM academies WHERE id = $1', [academyId]);
            } catch (e) {
                console.log('Skip academy:', e.message);
            }
        } else {
            // Just delete this user
            try {
                await db.query('DELETE FROM students WHERE user_id = $1', [userId]);
            } catch (e) {
                console.log('Skip student record:', e.message);
            }
            await db.query('DELETE FROM users WHERE id = $1', [userId]);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Delete error:', err.message);
        res.status(500).json({ error: 'Error al eliminar la cuenta' });
    }
});

module.exports = router;
