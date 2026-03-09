require('dotenv').config();

console.log('=== DB CHECK ===');
console.log('DATABASE_URL set:', !!process.env.DATABASE_URL);
console.log('DATABASE_URL value:', process.env.DATABASE_URL?.substring(0, 30) + '...');

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err.message, err.stack);
    // Don't crash, just log
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
    // Don't crash, just log
});

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./db');

// Call database initialization on startup
async function initializeDatabase() {
    console.log('Initializing database...');
    try {
        await db.initDb();
        console.log('Database initialized successfully using db.js schema');
    } catch (err) {
        console.error('Database initialization error:', err.message);
    }
}
initializeDatabase();
const PDFDocument = require('pdfkit');
const Groq = require("groq-sdk");
const { Resend } = require('resend');
const path = require('path');
const fs = require('fs');
const multerInstance = require('multer');


const pdfUpload = multerInstance({
    storage: multerInstance.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

// New Auth Requires
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const cookieParser = require('cookie-parser');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
app.get('/health', async (req, res) => {
    console.log('--- USERS ---');
    const users = await db.query("SELECT id, name, role, academy_id FROM users");
    console.log(users.rows || users);

    console.log('--- STUDENTS ---');
    const students = await db.query("SELECT id, name, user_id, assigned_teacher_id, academy_id FROM students");
    console.log(students.rows || students);

    console.log('--- ROOMS ---');
    const rooms = await db.query("SELECT * FROM rooms");
    console.log(rooms.rows || rooms);

    console.log('--- ROOM MEMBERS ---');
    const members = await db.query("SELECT * FROM room_members");
    console.log(members.rows || members);

    res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/debug/academies', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM academies');
        res.json(result.rows || result);
    } catch (err) {
        res.json({ error: err.message });
    }
});

app.get('/api/debug/users', async (req, res) => {
    try {
        const result = await db.query('SELECT id, name, email, role, academy_id FROM users');
        res.json(result.rows || result);
    } catch (err) {
        res.json({ error: err.message });
    }
});

const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e7 // 10MB
});
const isPostgres = !!process.env.DATABASE_URL;

global.roomsEnsured = false;

const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY || 'dummy' });
// DAILY CRON JOBS
const initCrons = require('./cron');

const PORT = process.env.PORT || 3000;

// Multer for chat uploads
const multer = require('multer');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/chat/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('Formato no permitido'));
    }
});


app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({ secret: 'academia-secret', resave: false, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());

// Public static files
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

// Generate Codes
const generateCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();
const generateUserCode = () => '#' + Math.floor(10000 + Math.random() * 90000);

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'dummy',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'dummy',
    callbackURL: process.env.NODE_ENV === 'production'
        ? 'https://web-production-d02f4.up.railway.app/auth/google/callback'
        : 'http://localhost:3000/auth/google/callback'
}, (accessToken, refreshToken, profile, cb) => cb(null, profile)));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// API Authentication Middlewares
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt';

const authenticateJWT = (req, res, next) => {
    let token = req.cookies.token;
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (token) {
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) {
                if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
                return res.redirect('/login');
            }
            req.user = user;
            next();
        });
    } else {
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
        res.redirect('/login');
    }
};

const requireRole = (role) => (req, res, next) => {
    if (req.user && req.user.role === role) next();
    else res.status(403).send('Forbidden');
};

const requireAdmin = requireRole('admin');
const requireTeacher = requireRole('teacher');
const requireStudent = requireRole('student');

// Auth Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public/login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public/register.html')));
app.get('/join', (req, res) => res.sendFile(path.join(__dirname, 'public/join.html')));
app.get('/teacher', (req, res) => res.sendFile(path.join(__dirname, 'public/teacher_dashboard.html')));
app.get('/teacher/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public/teacher_dashboard.html')));
app.get('/student', (req, res) => res.sendFile(path.join(__dirname, 'public/student_portal.html')));
app.get('/student-portal', (req, res) => res.sendFile(path.join(__dirname, 'public/student_portal.html')));

app.get('/api/auth/check-code/:code', (req, res) => {
    db.query('SELECT name FROM academies WHERE teacher_code = $1 OR student_code = $2', [req.params.code, req.params.code], (err, result) => {
        const acad = result?.rows[0];
        if (acad) res.json({ valid: true, academy_name: acad.name });
        else res.json({ valid: false });
    });
});

app.post('/auth/register', async (req, res) => {
    try {
        const { name, email, password, academy_name, academy_code } = req.body;
        const hash = bcrypt.hashSync(password, 8);
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
                const insertRoom = !!process.env.DATABASE_URL ? 'INSERT INTO rooms (academy_id, type) VALUES ($1, \x27direct\x27) RETURNING id' : 'INSERT INTO rooms (academy_id, type) VALUES ($1, "direct")';
                try {
                    const resRoom = await db.query(insertRoom, [acad.id]);
                    const roomId = !!process.env.DATABASE_URL && resRoom.rows ? resRoom.rows[0].id : resRoom.lastID;
                    await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, userId]);
                    await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, acad.owner_id]);
                } catch (e) { }
            } else if (role === 'teacher') {
                const insertRoom = !!process.env.DATABASE_URL ? 'INSERT INTO rooms (academy_id, type) VALUES ($1, \x27direct\x27) RETURNING id' : 'INSERT INTO rooms (academy_id, type) VALUES ($1, "direct")';
                try {
                    const resRoom = await db.query(insertRoom, [acad.id]);
                    const roomId = !!process.env.DATABASE_URL && resRoom.rows ? resRoom.rows[0].id : resRoom.lastID;
                    await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, userId]);
                    await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, acad.owner_id]);
                } catch (e) { }

                const resGroup = await db.query('SELECT id FROM rooms WHERE academy_id = $1 AND type = "group" AND name = "👥 Profesores & Admin"', [acad.id]);
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
                        !!process.env.DATABASE_URL ? 'INSERT INTO rooms (academy_id, type, name) VALUES ($1, "group", "👥 Profesores & Admin") RETURNING id' : 'INSERT INTO rooms (academy_id, type, name) VALUES ($1, "group", "👥 Profesores & Admin")', [acadId]
                    );
                    const roomId = !!process.env.DATABASE_URL && res3.rows ? res3.rows[0].id : res3.lastID;
                    await db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, userId]);
                } catch (e) { }

                res.json({ success: true, teacher_code: tCode, student_code: sCode, redirect: '/login' });
            } catch (err) {
                if (err.message.includes('UNIQUE constraint failed') || err.message.includes('duplicate key value')) {
                    return res.status(400).json({ error: 'Este email ya está registrado. Por favor inicia sesión.' });
                }
                res.status(500).json({ error: err.message });
            }
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password, role, academy_code } = req.body;

        // Find user
        const result = await db.query(
            'SELECT * FROM users WHERE email = $1', [email]
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
        const hash = user.password_hash || user.password;
        if (!hash || typeof hash !== 'string') {
            return res.status(500).json({ error: 'Error de configuración de cuenta (no password hash)' });
        }

        const bcrypt = require('bcryptjs');
        const valid = bcrypt.compareSync(password, hash);
        if (!valid) {
            return res.status(401).json({ error: 'Email o contraseña incorrectos' });
        }

        // Generate token
        const jwt = require('jsonwebtoken');
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, academy_id: user.academy_id, name: user.name, user_code: user.user_code },
            process.env.JWT_SECRET || 'super_secret_jwt',
            { expiresIn: '7d' }
        );
        res.cookie('token', token, { httpOnly: false }); // Ensure frontend socket authenticates correctly 

        console.log('Login successful:', user.email, 'role:', user.role);
        res.json({
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role, user_code: user.user_code }
        });

    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ error: 'Error interno: ' + err.message });
    }
});

app.post('/api/auth/join', async (req, res) => {
    try {
        const { academy_code, name, email, password, role } = req.body;

        if (!academy_code || !name || !email || !password || !role) {
            return res.status(400).json({ error: 'Todos los campos son obligatorios' });
        }

        const bcrypt = require('bcryptjs');
        const jwt = require('jsonwebtoken');

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
            'SELECT * FROM users WHERE email = $1', [email]
        );
        const user = newUserResult.rows?.[0] || newUserResult[0];

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, academy_id: user.academy_id },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '7d' }
        );

        console.log('User joined:', user.email, 'as', user.role, 'in academy', academy.id);
        res.json({
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role }
        });

    } catch (err) {
        console.error('Join error:', err.message);
        res.status(500).json({ error: 'Error interno: ' + err.message });
    }
});


app.get('/auth/google', (req, res, next) => {
    if (req.query.academy_code) res.cookie('pending_code', req.query.academy_code, { maxAge: 1000 * 60 * 15 });
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), async (req, res) => {
    const profile = req.user;
    const email = profile.emails[0].value;
    const name = profile.displayName;

    try {
        const existingResult = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        let user = existingResult?.rows ? existingResult.rows[0] : (existingResult || [])[0];

        if (!user) {
            // New User
            const pendingCode = req.cookies.pending_code;
            res.clearCookie('pending_code');

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

            const uRes = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
            user = uRes?.rows ? uRes.rows[0] : (uRes || [])[0];
        } else {
            // User exists - update google_id if missing
            if (!user.google_id) {
                await db.query('UPDATE users SET google_id = $1 WHERE id = $2', [profile.id, user.id]);
            }
        }

        const token = jwt.sign({ id: user.id, email: user.email, role: user.role, academy_id: user.academy_id, name: user.name, user_code: user.user_code }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie('token', token, { httpOnly: false });

        console.log('Google Auth success:', email, 'role:', user.role);

        // Explicit requested redirect implementation or fallback standard redirect
        if (req.cookies.wants_auth_success === '1' || req.query.auth_success) {
            return res.redirect(`/auth-success?token=${token}&role=${user.role}`);
        } else if (user.role === 'admin') res.redirect('/');
        else if (user.role === 'teacher') res.redirect('/teacher/dashboard');
        else res.redirect('/student-portal');

    } catch (err) {
        console.error('Google callback error:', err);
        res.redirect('/login?error=auth_failed');
    }
});

app.get('/auth/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/login');
});

app.get('/auth/me', authenticateJWT, (req, res) => {
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

app.get('/api/auth/me', authenticateJWT, async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const result = await db.query('SELECT id, name, role, academy_id FROM users WHERE id = $1', [userId]);
        const rows = result.rows || result;
        res.json(rows[0] || {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/user/my-code', authenticateJWT, (req, res) => {
    db.query('SELECT user_code FROM users WHERE id = $1', [req.user.id], (err, result) => {
        if (err || !result.rows[0]) return res.json({ user_code: null });
        res.json({ user_code: result.rows[0].user_code });
    });
});

app.put('/api/user/generate-code', authenticateJWT, (req, res) => {
    const newCode = '#' + Math.floor(10000 + Math.random() * 90000);
    db.query('UPDATE users SET user_code = $1 WHERE id = $2', [newCode, req.user.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ user_code: newCode });
    });
});

// Main Page Routes (Protected)
app.get('/', authenticateJWT, (req, res) => {
    if (req.user.role === 'admin') {
        res.sendFile(path.join(__dirname, 'public/index.html'));
    } else {
        res.redirect(req.user.role === 'teacher' ? '/teacher/dashboard' : '/student-portal');
    }
});
app.get('/teacher/dashboard', authenticateJWT, requireTeacher, (req, res) => res.sendFile(path.join(__dirname, 'public/teacher_dashboard.html')));
app.get('/student-portal', authenticateJWT, requireStudent, (req, res) => res.sendFile(path.join(__dirname, 'public/student_portal.html')));
app.get('/student-portal/exams', authenticateJWT, requireStudent, (req, res) => res.sendFile(path.join(__dirname, 'public/student_portal_exams.html')));
app.get('/student-portal/calendar', authenticateJWT, requireStudent, (req, res) => res.sendFile(path.join(__dirname, 'public/student_portal_calendar.html')));
app.get('/student-portal/payments', authenticateJWT, requireStudent, (req, res) => res.sendFile(path.join(__dirname, 'public/student_portal_payments.html')));
app.get('/exam-simulator', authenticateJWT, requireStudent, (req, res) => res.sendFile(path.join(__dirname, 'public/exam_simulator.html')));
app.get('/students', authenticateJWT, requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public/students.html')));
app.get('/sessions', authenticateJWT, (req, res) => res.sendFile(path.join(__dirname, 'public/sessions.html')));
app.get('/calendar', authenticateJWT, requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public/calendar.html')));
app.get('/exams', authenticateJWT, (req, res) => res.sendFile(path.join(__dirname, 'public/exams.html')));
app.get('/payments', authenticateJWT, (req, res) => res.sendFile(path.join(__dirname, 'public/payments.html')));
app.get('/ai-tutor', authenticateJWT, (req, res) => res.sendFile(path.join(__dirname, 'public/ai_tutor.html')));
app.get('/settings', authenticateJWT, requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public/settings.html')));
app.get('/chat', authenticateJWT, (req, res) => res.sendFile(path.join(__dirname, 'public/chat.html')));
app.get('/student/:id', authenticateJWT, (req, res) => {
    if (req.user.role === 'admin') {
        res.sendFile(path.join(__dirname, 'public/student_profile.html'));
    } else if (req.user.role === 'teacher') {
        res.redirect(`/teacher/student/${req.params.id}`);
    } else {
        res.redirect('/student-portal');
    }
});

app.get('/teacher/student/:id', authenticateJWT, requireTeacher, (req, res) => {
    db.query('SELECT id FROM students WHERE id = $1 AND assigned_teacher_id = $2', [req.params.id, req.user.id], (err, result) => {
        const row = result?.rows[0];
        if (row) res.sendFile(path.join(__dirname, 'public/teacher_student_profile.html'));
        else res.redirect('/teacher/dashboard');
    });
});

// Teacher Scoped Pages
app.get('/teacher/sessions', authenticateJWT, requireTeacher, (req, res) => res.sendFile(path.join(__dirname, 'public/teacher_sessions.html')));
app.get('/teacher/exams', authenticateJWT, requireTeacher, (req, res) => res.sendFile(path.join(__dirname, 'public/teacher_exams.html')));
app.get('/teacher/calendar', authenticateJWT, requireTeacher, (req, res) => res.sendFile(path.join(__dirname, 'public/teacher_calendar.html')));
app.get('/teacher/settings', authenticateJWT, requireTeacher, (req, res) => res.sendFile(path.join(__dirname, 'public/teacher_settings.html')));

// Admin Teacher Pages
app.get('/admin/teachers', authenticateJWT, (req, res) => res.sendFile(path.join(__dirname, 'public/admin_teachers.html')));
app.get('/admin/teacher/:id', authenticateJWT, (req, res) => res.sendFile(path.join(__dirname, 'public/admin_teacher_profile.html')));

// --- ADMIN TEACHERS API ---

// --- TEACHER PROFILE API ---
app.get('/api/teacher/profile', authenticateJWT, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT u.id, u.name, u.email, u.role, u.academy_id, a.teacher_code as code FROM users u LEFT JOIN academies a ON u.academy_id = a.id WHERE u.id = $1',
            [req.user.id]
        );
        const user = result.rows?.[0] || result[0];
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET all teachers in academy with stats
app.get('/api/admin/teachers', authenticateJWT, (req, res) => {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-31`;

    console.log('[teachers] academy_id=', req.user.academy_id);
    console.log(`[/api/admin/teachers] academy_id=${req.user.academy_id}, user=${req.user.name}, role=${req.user.role}, month=${monthStart} to ${monthEnd}`);

    const sql = `
        SELECT u.id, u.name, u.email, u.user_code, u.hourly_rate,
               COUNT(DISTINCT s.id) as student_count,
               COALESCE(SUM(CASE WHEN se.date >= $2 AND se.date <= $3 THEN se.duration_minutes ELSE 0 END), 0) / 60.0 as hours_this_month
        FROM users u
        LEFT JOIN students s ON s.assigned_teacher_id = u.id AND s.academy_id = $1
        LEFT JOIN sessions se ON se.student_id = s.id
        WHERE u.role = 'teacher' AND u.academy_id = $1
        GROUP BY u.id, u.name, u.email, u.user_code, u.hourly_rate
        ORDER BY u.name ASC
    `;
    db.query(sql, [req.user.academy_id, monthStart, monthEnd], (err, result) => {
        if (err) {
            console.error('[/api/admin/teachers] SQL error:', err.message);
            return res.status(500).json({ error: err.message });
        }
        console.log(`[/api/admin/teachers] Found ${result.rows.length} teachers`);
        const teachers = result.rows.map(t => ({
            ...t,
            hours_this_month: parseFloat(t.hours_this_month || 0).toFixed(1),
            amount_this_month: (parseFloat(t.hours_this_month || 0) * parseFloat(t.hourly_rate || 0)).toFixed(2)
        }));
        res.json(teachers);
    });
});

// GET single teacher profile with full stats
app.get('/api/admin/teachers/:id', authenticateJWT, (req, res) => {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-31`;

    db.query('SELECT id, name, email, user_code, hourly_rate FROM users WHERE id = $1 AND academy_id = $2 AND role = \'teacher\'',
        [req.params.id, req.user.academy_id], (err, tRes) => {
            if (err || !tRes.rows[0]) return res.status(404).json({ error: 'Teacher not found' });
            const teacher = tRes.rows[0];

            // Get assigned students with last session
            const studentsSQL = `
            SELECT s.*, 
                   MAX(se.date) as last_session_date,
                   COUNT(se.id) as total_sessions
            FROM students s
            LEFT JOIN sessions se ON se.student_id = s.id
            WHERE s.assigned_teacher_id = $1 AND s.academy_id = $2
            GROUP BY s.id
            ORDER BY s.name ASC
        `;
            db.query(studentsSQL, [req.params.id, req.user.academy_id], (err, sRes) => {
                const students = sRes?.rows || [];

                // Sessions this month
                const sessionsSQL = `
                SELECT se.*, s.name as student_name
                FROM sessions se
                JOIN students s ON se.student_id = s.id
                WHERE s.assigned_teacher_id = $1 AND s.academy_id = $2 AND se.date >= $3 AND se.date <= $4
                ORDER BY se.date DESC
            `;
                db.query(sessionsSQL, [req.params.id, req.user.academy_id, monthStart, monthEnd], (err, seRes) => {
                    const sessions = seRes?.rows || [];
                    const totalMinutes = sessions.reduce((acc, s) => acc + (s.duration_minutes || 0), 0);
                    const hoursThisMonth = (totalMinutes / 60).toFixed(1);
                    const amountThisMonth = (parseFloat(hoursThisMonth) * parseFloat(teacher.hourly_rate || 0)).toFixed(2);

                    // Avg score of students
                    const avgScoreSQL = `
                    SELECT AVG(e.score) as avg_score
                    FROM exams e
                    JOIN students s ON e.student_id = s.id
                    WHERE s.assigned_teacher_id = $1 AND s.academy_id = $2
                `;
                    db.query(avgScoreSQL, [req.params.id, req.user.academy_id], (err, avgRes) => {
                        const avgScore = avgRes?.rows[0]?.avg_score ? parseFloat(avgRes.rows[0].avg_score).toFixed(1) : '-';

                        // Payment history
                        db.query('SELECT * FROM teacher_payments WHERE teacher_id = $1 ORDER BY year DESC, month DESC', [req.params.id], (err, payRes) => {
                            res.json({
                                teacher,
                                students,
                                sessions,
                                stats: {
                                    studentCount: students.length,
                                    hoursThisMonth,
                                    amountThisMonth,
                                    avgScore
                                },
                                payments: payRes?.rows || []
                            });
                        });
                    });
                });
            });
        });
});

// GET sessions for teacher in month
app.get('/api/admin/teachers/:id/sessions', authenticateJWT, (req, res) => {
    const { month } = req.query; // YYYY-MM
    const monthStart = month ? `${month}-01` : new Date().toISOString().slice(0, 7) + '-01';
    const monthEnd = month ? `${month}-31` : new Date().toISOString().slice(0, 7) + '-31';

    const sql = `
        SELECT se.*, s.name as student_name
        FROM sessions se
        JOIN students s ON se.student_id = s.id
        WHERE s.assigned_teacher_id = $1 AND s.academy_id = $2 AND se.date >= $3 AND se.date <= $4
        ORDER BY se.date DESC
    `;
    db.query(sql, [req.params.id, req.user.academy_id, monthStart, monthEnd], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows);
    });
});

// PUT update teacher hourly rate
app.put('/api/admin/teachers/:id/rate', authenticateJWT, (req, res) => {
    const { hourly_rate } = req.body;
    db.query('UPDATE users SET hourly_rate = $1 WHERE id = $2 AND academy_id = $3 AND role = \'teacher\'',
        [hourly_rate, req.params.id, req.user.academy_id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

// POST assign student to teacher
app.post('/api/admin/teachers/:id/assign-student', authenticateJWT, (req, res) => {
    const { student_id } = req.body;
    db.query('UPDATE students SET assigned_teacher_id = $1 WHERE id = $2 AND academy_id = $3',
        [req.params.id, student_id, req.user.academy_id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

// DELETE unassign student from teacher
app.delete('/api/admin/teachers/:id/unassign-student/:studentId', authenticateJWT, (req, res) => {
    db.query('UPDATE students SET assigned_teacher_id = NULL WHERE id = $1 AND assigned_teacher_id = $2 AND academy_id = $3',
        [req.params.studentId, req.params.id, req.user.academy_id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

// POST mark teacher month as paid
app.post('/api/admin/teachers/:id/mark-paid', authenticateJWT, (req, res) => {
    const { month, year, hours, hourly_rate, total } = req.body;
    // Upsert teacher_payment record
    const checkSQL = 'SELECT id FROM teacher_payments WHERE teacher_id = $1 AND month = $2 AND year = $3';
    db.query(checkSQL, [req.params.id, month, year], (err, r) => {
        if (r?.rows[0]) {
            db.query('UPDATE teacher_payments SET status = \'paid\', paid_date = $1, hours = $2, hourly_rate = $3, total = $4 WHERE id = $5',
                [new Date().toISOString().split('T')[0], hours, hourly_rate, total, r.rows[0].id], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ success: true });
                });
        } else {
            db.query('INSERT INTO teacher_payments (teacher_id, academy_id, month, year, hours, hourly_rate, total, status, paid_date) VALUES ($1, $2, $3, $4, $5, $6, $7, \'paid\', $8)',
                [req.params.id, req.user.academy_id, month, year, hours, hourly_rate, total, new Date().toISOString().split('T')[0]], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ success: true });
                });
        }
    });
});



// GET available slots depending on role
app.get('/api/calendar/slots', authenticateJWT, (req, res) => {
    let sql = `
        SELECT a.*, u.name as teacher_name, s.name as student_name 
        FROM available_slots a 
        JOIN users u ON a.teacher_id = u.id 
        LEFT JOIN students s ON a.student_id = s.id 
        WHERE a.academy_id = $1
    `;
    let params = [req.user.academy_id];

    if (req.user.role === 'teacher') {
        sql += ` AND a.teacher_id = $2`;
        params.push(req.user.id);
    } else if (req.user.role === 'student') {
        // Fetch slots only for their assigned teacher
        db.query('SELECT assigned_teacher_id FROM students WHERE user_id = $1', [req.user.id], (err, r) => {
            if (err || !r.rows[0]) return res.json([]);
            sql += ` AND a.teacher_id = $2`;
            params.push(r.rows[0].assigned_teacher_id);
            db.query(sql + ' ORDER BY a.start_datetime ASC', params, (err, result) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json(result.rows);
            });
        });
        return;
    }

    db.query(sql + ' ORDER BY a.start_datetime ASC', params, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows);
    });
});

// Teacher creates slots
app.post('/api/calendar/slots', authenticateJWT, requireTeacher, (req, res) => {
    const { start_datetime, end_datetime, student_id, notes } = req.body;
    const isBooked = student_id ? true : false;
    db.query(
        'INSERT INTO available_slots (teacher_id, academy_id, start_datetime, end_datetime, is_booked, student_id, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [req.user.id, req.user.academy_id, start_datetime, end_datetime, isBooked, student_id || null, notes || null],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, is_booked: isBooked });
        }
    );
});

// Teacher or Admin deletes slot
app.delete('/api/calendar/slots/:id', authenticateJWT, (req, res) => {
    if (req.user.role === 'student') return res.status(403).json({ error: 'Access denied' });
    db.query('DELETE FROM available_slots WHERE id = $1 AND is_booked = false', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Teacher assigns a student to a free slot
app.put('/api/calendar/slots/:id', authenticateJWT, requireTeacher, (req, res) => {
    const { student_id, is_booked } = req.body;
    db.query(
        'UPDATE available_slots SET student_id = $1, is_booked = $2 WHERE id = $3 AND teacher_id = $4',
        [student_id, is_booked, req.params.id, req.user.id],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});


// Student books a slot
app.post('/api/calendar/slots/:id/book', authenticateJWT, requireStudent, (req, res) => {
    db.query('SELECT id, name FROM students WHERE user_id = $1', [req.user.id], (err, r) => {
        if (err || !r.rows[0]) return res.status(404).json({ error: 'Student not found' });
        const studentId = r.rows[0].id;

        db.query('UPDATE available_slots SET is_booked = true, student_id = $1 WHERE id = $2 AND is_booked = false',
            [studentId, req.params.id], (upErr, upRes) => {
                if (upErr) return res.status(500).json({ error: upErr.message });
                if (upRes.rowCount === 0) return res.status(400).json({ error: 'Slot ya reservado' });

                // Generate session record
                db.query('SELECT start_datetime FROM available_slots WHERE id = $1', [req.params.id], (sErr, sRes) => {
                    if (!sErr && sRes.rows[0]) {
                        const dt = sRes.rows[0].start_datetime.split('T')[0];
                        db.query('INSERT INTO sessions (student_id, date, duration_minutes, homework_done, slot_id) VALUES ($1, $2, 60, false, $3)',
                            [studentId, dt, req.params.id]);
                    }
                });
                res.json({ success: true });
            });
    });
});

// Student cancels slot booking
app.post('/api/calendar/slots/:id/cancel', authenticateJWT, requireStudent, (req, res) => {
    db.query('SELECT start_datetime FROM available_slots WHERE id = $1', [req.params.id], (err, r) => {
        if (err || !r.rows[0]) return res.status(404).json({ error: 'Slot not found' });
        const start = new Date(r.rows[0].start_datetime);
        const now = new Date();
        const diffHours = (start - now) / (1000 * 60 * 60);

        if (diffHours < 24) return res.status(400).json({ error: 'Se requieren al menos 24 horas de antelación para cancelar' });

        db.query('UPDATE available_slots SET is_booked = false, student_id = NULL WHERE id = $1', [req.params.id], (upErr) => {
            if (upErr) return res.status(500).json({ error: upErr.message });
            db.query('DELETE FROM sessions WHERE slot_id = $1', [req.params.id]);
            res.json({ success: true });
        });
    });
});

// --- AI TUTOR & SIMULATOR ROUTES ---

app.post('/api/ai-tutor/extract-pdf', authenticateJWT, async (req, res) => {
    const uploadMem = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 10 * 1024 * 1024 }
    }).single('pdf');

    uploadMem(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No PDF recibido' });

        try {
            const pdf = require('pdf-parse');
            const data = await pdf(req.file.buffer);
            const text = data.text.trim().substring(0, 8000);
            res.json({ text, pages: data.numpages, filename: req.file.originalname });
        } catch (e) {
            console.error('pdf-parse error:', e);
            res.status(500).json({ error: 'Error leyendo PDF: ' + e.message });
        }
    });
});

app.post('/api/ai-tutor/chat', authenticateJWT, async (req, res) => {
    const { messages } = req.body;
    let systemPrompt = "Eres un asistente educativo inteligente de AcademiaPro. Ayudas a estudiantes con cualquier materia y duda académica. Explicas conceptos de forma clara y adaptada al nivel del alumno. Eres paciente, motivador y pedagógico. Responde SIEMPRE en español.";

    try {
        if (req.user.role === 'teacher') {
            systemPrompt = "Eres un asistente pedagógico inteligente de AcademiaPro. Ayudas a profesores a preparar clases, crear ejercicios, explicar conceptos difíciles, gestionar alumnos y mejorar su metodología docente. Responde SIEMPRE en español.";
        }

        // Check if any message contains a doc/image object (like PDF base64).
        const hasComplexContent = messages.some(m => Array.isArray(m.content));
        // Fallback model if we have documents (llama-3.2-11b-vision-preview or fallback versatile)
        const modelToUse = hasComplexContent ? "llama-3.2-11b-vision-preview" : "llama-3.3-70b-versatile";

        const apiResponse = await groqClient.chat.completions.create({
            model: modelToUse,
            messages: [{ role: 'system', content: systemPrompt }, ...messages],
            temperature: 0.7,
            max_tokens: 1024,
        });

        res.json({ response: apiResponse.choices[0].message.content });
    } catch (e) {
        console.error('Groq Error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/ai-tutor/generate-pdf', authenticateJWT, (req, res) => {
    try {
        const { text } = req.body;
        const doc = new PDFDocument();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Tutor_IA_${Date.now()}.pdf`);
        doc.pipe(res);

        // Header
        doc.rect(0, 0, 612, 100).fill('#1A56A0');
        doc.fillColor('white').fontSize(24).text('AcademiaPro - Tutor IA', 50, 40);
        doc.fontSize(14).text(new Date().toLocaleDateString('es-ES'), 450, 45);

        doc.moveDown(4);
        doc.fillColor('black').fontSize(12).text(text, { align: 'justify', lineGap: 5 });

        res.end();
    } catch (err) {
        console.error('PDF gen error:', err);
        res.status(500).json({ error: 'Failed to generate PDF' });
    }
});

app.post('/api/ai-tutor/extract-pdf', authenticateJWT, pdfUpload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No PDF provided' });

        const data = await pdfParse(req.file.buffer);
        if (!data || !data.text) {
            return res.status(500).json({ error: 'Could not extract text' });
        }

        res.json({ text: data.text });
    } catch (err) {
        console.error('PDF Extract Error:', err);
        res.status(500).json({ error: 'Failed to extract text from PDF' });
    }
});

app.post('/api/exam-simulator/generate', authenticateJWT, requireStudent, async (req, res) => {
    try {
        const { topic, difficulty, numQuestions, course } = req.body;
        const prompt = `Genera un examen de ${topic} para ${course} con ${numQuestions} preguntas de nivel ${difficulty}. 
        Formato JSON estricto:
        {
          "title": "título del examen",
          "questions": [
            {
              "question": "enunciado de la pregunta",
              "type": "multiple_choice" or "open",
              "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
              "correct_answer": "A" or "respuesta completa",
              "explanation": "explicación de la respuesta correcta"
            }
          ]
        }`;

        const apiResponse = await groqClient.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: 'system', content: 'Eres un generador de exámenes que responde ÚNICA Y EXCLUSIVAMENTE con un JSON válido en español. No añadas texto explicativo, ni Markdown (tampoco \`\`\`json), sólo devuelve las llaves { } del JSON y su contenido. El formato de options para multiple_choice debe ser un array de 4 strings que empiecen con "A) ", "B) ", "C) " y "D) ".' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.5,
            response_format: { type: "json_object" }
        });

        const jsonContent = JSON.parse(apiResponse.choices[0].message.content);
        res.json(jsonContent);
    } catch (err) {
        console.error('Route error:', err.message);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
});


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
                    const data = await mammoth.extractRawText({ buffer: req.file.buffer });
                    transcript_text = data.value;
                } catch (e) {
                    console.error('Error mammoth:', e);
                    return res.status(400).json({ error: 'Error procesando .docx. Asegúrate de que el documento es válido.' });
                }
            } else if (ext === '.txt') {
                transcript_text = req.file.buffer.toString('utf8');
            } else {
                return res.status(400).json({ error: 'Formato no soportado (.pdf, .docx, .txt)' });
            }
        }

        if (!student_id || !transcript_text || transcript_text.trim().length < 10) {
            return res.status(400).json({ error: 'Se requiere ID de alumno y un texto válido de la clase (mín. 10 caracteres).' });
        }

        const prompt = `Analiza esta transcripción de clase y genera un resumen estructurado. 
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
${transcript_text}`;

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
        } catch (e) {
            console.error('JSON Parse error', e, apiResponse.choices[0].message.content);
            return res.status(500).json({ error: 'La IA no devolvió un JSON válido.' });
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
        const sender_id = req.user.id || req.user.userId;
        const { student_id, summary } = req.body;
        const academy_id = req.user.academy_id;

        if (!student_id || !summary) {
            return res.status(400).json({ error: 'Faltan datos requeridos' });
        }

        // Step 1: Resolve student USER id
        let studentUserId = null;

        // Try: maybe student_id is already a user id
        const directUser = await db.query(
            "SELECT id FROM users WHERE id = $1 AND role = 'student' AND academy_id = $2",
            [student_id, academy_id]
        );
        const duRows = directUser.rows || directUser;
        if (duRows && duRows.length > 0) {
            studentUserId = duRows[0].id;
        }

        // If not found, try: student_id is students.id, find linked user
        if (!studentUserId) {
            const linkedUser = await db.query(
                "SELECT user_id FROM students WHERE id = $1 AND user_id IS NOT NULL",
                [student_id]
            );
            const luRows = linkedUser.rows || linkedUser;
            if (luRows && luRows.length > 0) {
                studentUserId = luRows[0].user_id;
            }
        }

        // If still not found, try matching by name
        if (!studentUserId) {
            const studentRecord = await db.query(
                "SELECT name FROM students WHERE id = $1",
                [student_id]
            );
            const srRows = studentRecord.rows || studentRecord;
            if (srRows && srRows.length > 0) {
                const nameMatch = await db.query(
                    "SELECT id FROM users WHERE academy_id = $1 AND role = 'student' AND LOWER(name) = LOWER($2) LIMIT 1",
                    [academy_id, srRows[0].name]
                );
                const nmRows = nameMatch.rows || nameMatch;
                if (nmRows && nmRows.length > 0) {
                    studentUserId = nmRows[0].id;
                    // Fix the link for future use
                    await db.query(
                        "UPDATE students SET user_id = $1 WHERE id = $2",
                        [studentUserId, student_id]
                    );
                }
            }
        }

        if (!studentUserId) {
            return res.status(404).json({
                error: 'No se encontró el usuario del alumno. El alumno debe haber iniciado sesión al menos una vez.'
            });
        }

        // Step 2: Find or create direct room between sender and studentUserId
        const sqlFindRoom = `
            SELECT r.id FROM rooms r
            JOIN room_members rm1 ON rm1.room_id = r.id AND rm1.user_id = $1
            JOIN room_members rm2 ON rm2.room_id = r.id AND rm2.user_id = $2
            WHERE r.type = 'direct' AND r.academy_id = $3
            LIMIT 1
        `;

        const existingRooms = await db.query(sqlFindRoom, [sender_id, studentUserId, academy_id]);
        const erRows = existingRooms.rows || existingRooms;

        let roomId;
        if (erRows && erRows.length > 0) {
            roomId = erRows[0].id;
        } else {
            // Create room
            const insertRoomSql = isPostgres
                ? "INSERT INTO rooms (academy_id, type, name, created_at) VALUES ($1, 'direct', 'Direct', NOW()) RETURNING id"
                : "INSERT INTO rooms (academy_id, type, name, created_at) VALUES ($1, 'direct', 'Direct', datetime('now'))";

            const newRoom = await db.query(insertRoomSql, [academy_id]);
            roomId = isPostgres && newRoom.rows ? newRoom.rows[0].id : newRoom.lastID;

            const insertMemberSql = isPostgres
                ? "INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
                : "INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES ($1, $2)";

            await db.query(insertMemberSql, [roomId, sender_id]);
            await db.query(insertMemberSql, [roomId, studentUserId]);
        }

        // Step 3: Build message
        let s;
        try {
            s = typeof summary === 'string' ? JSON.parse(summary) : summary;
        } catch (e) {
            s = { resumen: String(summary), deberes: [], conceptos_clave: [], pistas_profesor: [], mensaje_motivador: '' };
        }

        const messageText = `📚 *Resumen de tu clase de hoy*\n\n${s.resumen || ''}\n\n` +
            `📝 *Deberes para casa:*\n${(s.deberes || []).map(d => '• ' + d).join('\n')}\n\n` +
            `💡 *Conceptos importantes:*\n${(s.conceptos_clave || []).map(c => '• ' + c).join('\n')}\n\n` +
            `🎯 *Consejos de tu profe:*\n${(s.pistas_profesor || []).map(p => '• ' + p).join('\n')}\n\n` +
            `💪 ${s.mensaje_motivador || ''}`;

        // Step 4: Save message
        const insertMsgSql = isPostgres
            ? `INSERT INTO messages (room_id, sender_id, content, academy_id, read, created_at)
               VALUES ($1, $2, $3, $4, 0, NOW())`
            : `INSERT INTO messages (room_id, sender_id, content, academy_id, read, created_at)
               VALUES ($1, $2, $3, $4, 0, datetime('now'))`;

        await db.query(insertMsgSql, [roomId, sender_id, messageText, academy_id]);

        // Step 5: Emit
        const senderInfo = await db.query('SELECT name FROM users WHERE id = $1', [sender_id]);
        const senderRows = senderInfo.rows || senderInfo;

        io.to('room_' + roomId).emit('new_message', {
            room_id: roomId,
            sender_id: sender_id,
            sender_name: senderRows[0]?.name || 'Profesor',
            content: messageText,
            created_at: new Date().toISOString()
        });

        res.json({ success: true, room_id: roomId });

    } catch (err) {
        console.error('send-to-chat error:', err);
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/transcripts/history', authenticateJWT, (req, res) => {
    let q = `
        SELECT t.id, t.created_at, t.processed_json, t.student_id, s.name as student_name
        FROM transcripts t
        JOIN students s ON t.student_id = s.id
        WHERE t.academy_id = $1
    `;
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

// Add express static for other files (must be AFTER root and routes)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Risk logic
const checkStudentRisk = (studentId) => {
    db.query(`SELECT * FROM students WHERE id = $1`, [studentId], (err, result) => {
        const student = result?.rows[0];
        if (err || !student) return;
        db.query(`SELECT homework_done FROM sessions WHERE student_id = $1 ORDER BY date DESC LIMIT 3`, [studentId], (err, resSessions) => {
            const sessions = resSessions?.rows || [];
            if (!err && sessions.length >= 3) {
                const allNoHomework = sessions.every(s => !s.homework_done);
                if (allNoHomework) {
                    db.query(`UPDATE students SET status = 'at_risk' WHERE id = $1`, [studentId]);
                    return;
                }
            }
            db.query(`SELECT score FROM exams WHERE student_id = $1 ORDER BY date DESC LIMIT 4`, [studentId], (err, resExams) => {
                const exams = resExams?.rows || [];
                if (!err && exams.length >= 4) {
                    const last2Avg = (exams[0].score + exams[1].score) / 2;
                    const prev2Avg = (exams[2].score + exams[3].score) / 2;
                    if (last2Avg < prev2Avg) {
                        db.query(`UPDATE students SET status = 'at_risk' WHERE id = $1`, [studentId]);
                    }
                }
            });
        });
    });
};

// DELETE student from academy
app.delete('/api/admin/students/:id', authenticateJWT, requireAdmin, (req, res) => {
    db.query('SELECT user_id FROM students WHERE id = $1 AND academy_id = $2', [req.params.id, req.user.academy_id], (err, row) => {
        const student = row?.rows[0];
        if (!student) return res.status(404).json({ error: 'Student not found' });

        db.query('DELETE FROM sessions WHERE student_id = $1', [req.params.id]);
        db.query('DELETE FROM exams WHERE student_id = $1', [req.params.id]);
        db.query('DELETE FROM payments WHERE student_id = $1', [req.params.id]);

        db.query('DELETE FROM students WHERE id = $1', [req.params.id], () => {
            if (student.user_id) {
                db.query('UPDATE users SET academy_id = NULL WHERE id = $1', [student.user_id]);
            }
            res.json({ success: true });
        });
    });
});

// DELETE teacher from academy
app.delete('/api/admin/teachers/:id', authenticateJWT, requireAdmin, (req, res) => {
    db.query('SELECT id FROM users WHERE id = $1 AND role = "teacher" AND academy_id = $2', [req.params.id, req.user.academy_id], (err, row) => {
        const teacher = row?.rows[0];
        if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

        db.query('UPDATE students SET assigned_teacher_id = NULL WHERE assigned_teacher_id = $1 AND academy_id = $2', [req.params.id, req.user.academy_id]);
        db.query('UPDATE users SET academy_id = NULL WHERE id = $1', [req.params.id], () => {
            res.json({ success: true });
        });
    });
});

// CHANGE student's teacher

// CHANGE student's teacher
app.put('/api/admin/students/:id/teacher', authenticateJWT, requireAdmin, async (req, res) => {
    const assigned_teacher_id = req.body.assigned_teacher_id || null;
    try {
        let row = await db.query('SELECT user_id, name FROM students WHERE id = $1 AND academy_id = $2', [req.params.id, req.user.academy_id]);
        const student = row?.rows && row.rows.length ? row.rows[0] : null;
        if (!student) return res.status(404).json({ error: 'Student not found' });

        await db.query('UPDATE students SET assigned_teacher_id = $1 WHERE id = $2', [assigned_teacher_id, req.params.id]);
        await ensureAcademyRooms(req.user.academy_id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// CRUD Generic - Overriding it to support multitenancy slightly differently, we'll rewrite specific endpoints to be safe.
app.get('/api/students', authenticateJWT, (req, res) => {
    let q = `
        SELECT s.*, u.name as teacher_name 
        FROM students s 
        LEFT JOIN users u ON s.assigned_teacher_id = u.id 
        WHERE s.academy_id = $1
    `;
    let params = [req.user.academy_id];

    if (req.user.role === 'teacher') {
        q += ' AND s.assigned_teacher_id = $2';
        params.push(req.user.id);
    }

    db.query(q, params, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows);
    });
});

app.get('/api/students-list', authenticateJWT, (req, res) => {
    const academyId = req.user.academy_id;
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);

    let sql = `
        SELECT s.*, u.name as teacher_name,
        (SELECT COUNT(*) FROM sessions WHERE student_id = s.id AND date LIKE $1) as sessions_this_month,
        (SELECT MAX(date) FROM sessions WHERE student_id = s.id) as last_session_date
        FROM students s
        LEFT JOIN users u ON s.assigned_teacher_id = u.id
        WHERE s.academy_id = $2
    `;
    let params = [`${currentMonth}%`, academyId];

    if (req.user.role === 'teacher') {
        sql += ' AND s.assigned_teacher_id = $3';
        params.push(req.user.id);
    }

    db.query(sql, params, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows);
    });
});

app.get('/api/teachers', authenticateJWT, requireAdmin, (req, res) => {
    db.query('SELECT id, name FROM users WHERE academy_id = $1 AND role = "teacher"', [req.user.academy_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows);
    });
});

app.get('/api/teachers/rates', authenticateJWT, requireAdmin, (req, res) => {
    db.query('SELECT id, name, hourly_rate FROM users WHERE academy_id = $1 AND role = "teacher"', [req.user.academy_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows);
    });
});

app.put('/api/teachers/:id/rate', authenticateJWT, requireAdmin, (req, res) => {
    db.query('UPDATE users SET hourly_rate = $1 WHERE id = $2 AND academy_id = $3 AND role = "teacher"',
        [req.body.hourly_rate || 0, req.params.id, req.user.academy_id], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

app.get('/api/admin/unassigned-count', authenticateJWT, requireAdmin, (req, res) => {
    db.query('SELECT COUNT(*) as count FROM students WHERE academy_id = $1 AND assigned_teacher_id IS NULL', [req.user.academy_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ count: result.rows[0]?.count || 0 });
    });
});

app.post('/api/admin/add-user-by-code', authenticateJWT, requireAdmin, async (req, res) => {
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

        await ensureAcademyRooms(acadId);
        res.json({ success: true, name: user.name, role });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/students/:id', authenticateJWT, requireAdmin, (req, res) => {
    const keys = Object.keys(req.body);
    const values = Object.values(req.body);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(',');
    values.push(req.params.id, req.user.academy_id);
    const sql = `UPDATE students SET ${setClause} WHERE id = $${keys.length + 1} AND academy_id = $${keys.length + 2}`;
    db.query(sql, values, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/sessions', authenticateJWT, (req, res) => {
    let sql = 'SELECT s.*, st.name as student_name FROM sessions s JOIN students st ON s.student_id = st.id WHERE st.academy_id = $1';
    let params = [req.user.academy_id];

    if (req.user.role === 'teacher') {
        sql += ' AND st.assigned_teacher_id = $2';
        params.push(req.user.id);
    }

    db.query(sql + ' ORDER BY s.date DESC', params, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows);
    });
});

app.get('/api/sessions-list', authenticateJWT, (req, res) => {
    let sql = 'SELECT s.*, st.name as student_name FROM sessions s JOIN students st ON s.student_id = st.id WHERE st.academy_id = $1';
    let params = [req.user.academy_id];

    if (req.user.role === 'teacher') {
        sql += ' AND st.assigned_teacher_id = $2';
        params.push(req.user.id);
    }

    db.query(sql + ' ORDER BY s.date DESC', params, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        const rows = result.rows;

        // Calculate stats
        const now = new Date();
        const currentMonth = now.toISOString().slice(0, 7);
        const thisMonth = rows.filter(s => s.date.startsWith(currentMonth));

        const stats = {
            totalThisMonth: thisMonth.length,
            avgDuration: thisMonth.length > 0 ? Math.round(thisMonth.reduce((acc, s) => acc + s.duration_minutes, 0) / thisMonth.length) : 0,
            homeworkRate: thisMonth.length > 0 ? Math.round((thisMonth.filter(s => s.homework_done).length / thisMonth.length) * 100) : 0,
            sessionsThisWeek: rows.filter(s => {
                const sDate = new Date(s.date);
                const diff = (now - sDate) / (1000 * 60 * 60 * 24);
                return diff >= 0 && diff <= 7;
            }).length
        };

        res.json({ sessions: rows, stats });
    });
});


app.get('/api/payments', authenticateJWT, (req, res) => {
    db.query('SELECT p.* FROM payments p JOIN students st ON p.student_id = st.id WHERE st.academy_id = $1', [req.user.academy_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows);
    });
});

app.get('/api/teacher/students', authenticateJWT, requireTeacher, (req, res) => {
    db.query(`SELECT s.*, 
            (SELECT MAX(date) FROM sessions WHERE student_id = s.id) as last_session 
            FROM students s 
            WHERE s.academy_id = $1 AND s.assigned_teacher_id = $2`,
        [req.user.academy_id, req.user.id], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(result.rows);
        });
});



app.get('/api/teacher/dashboard-stats', authenticateJWT, requireTeacher, (req, res) => {
    const teacherId = req.user.id;
    const academyId = req.user.academy_id;
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);

    const stats = {};
    db.query('SELECT COUNT(*) as count FROM students WHERE assigned_teacher_id = $1 AND academy_id = $2', [teacherId, academyId], (err, result1) => {
        stats.studentCount = result1?.rows[0]?.count || 0;
        db.query('SELECT COUNT(*) as count FROM sessions s JOIN students st ON s.student_id = st.id WHERE st.assigned_teacher_id = $1 AND s.date LIKE $2', [teacherId, `${currentMonth}%`], (err, result2) => {
            stats.sessionCount = result2?.rows[0]?.count || 0;
            db.query('SELECT COUNT(*) as count FROM students WHERE assigned_teacher_id = $1 AND status = "at_risk"', [teacherId], (err, result3) => {
                stats.atRiskCount = result3?.rows[0]?.count || 0;
                db.query('SELECT AVG(score) as avg FROM exams e JOIN students st ON e.student_id = st.id WHERE st.assigned_teacher_id = $1', [teacherId], (err, result4) => {
                    stats.avgScore = result4?.rows[0]?.avg ? parseFloat(result4.rows[0].avg).toFixed(1) : 0;

                    // Add recent activity
                    db.query(`SELECT s.*, st.name as student_name FROM sessions s 
                            JOIN students st ON s.student_id = st.id 
                            WHERE st.assigned_teacher_id = $1 
                            ORDER BY s.date DESC LIMIT 5`, [teacherId], (err, result5) => {
                        stats.recentActivity = result5?.rows || [];
                        res.json(stats);
                    });
                });
            });
        });
    });
});

// Scoping Exams API
app.get('/api/exams', authenticateJWT, (req, res) => {
    let sql = 'SELECT e.*, st.name as student_name FROM exams e JOIN students st ON e.student_id = st.id WHERE st.academy_id = $1';
    let params = [req.user.academy_id];

    if (req.user.role === 'teacher') {
        sql += ' AND st.assigned_teacher_id = $2';
        params.push(req.user.id);
    }

    db.query(sql + ' ORDER BY e.date DESC', params, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result.rows);
    });
});




app.get('/api/exams-list', authenticateJWT, (req, res) => {
    let sql = 'SELECT e.*, st.name as student_name FROM exams e JOIN students st ON e.student_id = st.id WHERE st.academy_id = $1';
    let params = [req.user.academy_id];

    if (req.user.role === 'teacher') {
        sql += ' AND st.assigned_teacher_id = $2';
        params.push(req.user.id);
    }

    db.query(sql + ' ORDER BY e.date DESC', params, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        const rows = result.rows;

        const stats = {
            totalExams: rows.length,
            avgScore: rows.length > 0 ? (rows.reduce((acc, e) => acc + e.score, 0) / rows.length).toFixed(1) : 0,
            passRate: rows.length > 0 ? Math.round((rows.filter(e => e.score >= 5).length / rows.length) * 100) : 0
        };

        res.json({ exams: rows, stats });
    });
});

// Detailed Student Profile Data
app.get('/api/student-detail/:id', authenticateJWT, (req, res) => {
    const id = req.params.id;
    const result = {};

    db.query(`
        SELECT s.*, u.name as teacher_name
        FROM students s
        LEFT JOIN users u ON s.assigned_teacher_id = u.id
        WHERE s.id = $1 AND s.academy_id = $2
    `, [id, req.user.academy_id], (err, resData) => {
        if (err) return res.status(500).json({ error: err.message });
        const student = resData?.rows[0];
        if (!student) return res.status(404).json({ error: 'Student not found' });
        result.student = student;

        db.query(`SELECT * FROM sessions WHERE student_id = $1 ORDER BY date DESC`, [id], (err, resSessions) => {
            result.sessions = resSessions?.rows || [];
            db.query(`SELECT * FROM exams WHERE student_id = $1 ORDER BY date DESC`, [id], (err, resExams) => {
                result.exams = resExams?.rows || [];
                db.query(`SELECT * FROM payments WHERE student_id = $1 ORDER BY due_date DESC`, [id], (err, resPayments) => {
                    result.payments = resPayments?.rows || [];
                    res.json(result);
                });
            });
        });
    });
});

// Enriched API Data endpoints
app.get('/api/payments-data', authenticateJWT, (req, res) => {
    const sql = `
        SELECT p.*, s.name as student_name, s.monthly_fee as student_monthly_fee
        FROM payments p
        JOIN students s ON p.student_id = s.id
        WHERE s.academy_id = $1
        ORDER BY p.due_date DESC
    `;
    db.query(sql, [req.user.academy_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        const allPayments = result.rows;
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const currentMonth = todayStr.slice(0, 7);
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);

        let collectedThisMonth = 0, collectedLastMonth = 0, pendingTotal = 0, overdueCount = 0, overdueAmount = 0;

        allPayments.forEach(p => {
            if (p.status === 'pagado') {
                if (p.paid_date && p.paid_date.startsWith(currentMonth)) collectedThisMonth += p.amount;
                if (p.paid_date && p.paid_date.startsWith(lastMonth)) collectedLastMonth += p.amount;
            } else {
                pendingTotal += p.amount;
                if (p.due_date < todayStr) { overdueCount++; overdueAmount += p.amount; }
            }
        });
        const percentChange = collectedLastMonth > 0 ? (((collectedThisMonth - collectedLastMonth) / collectedLastMonth) * 100).toFixed(1) : 0;
        res.json({
            payments: allPayments,
            stats: { collectedThisMonth, pendingTotal, overdueCount, overdueAmount, percentChange, trend: percentChange >= 0 ? '↑' : '↓' }
        });
    });
});

app.post('/api/payments/auto-generate', authenticateJWT, requireAdmin, (req, res) => {
    const acadId = req.user.academy_id;
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const lastDayOfMonth = new Date(year, month, 0).getDate();

    db.query('SELECT * FROM students WHERE academy_id = $1 AND monthly_fee > 0', [acadId], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        const students = result.rows || [];

        students.forEach(s => {
            const payDay = s.payment_day || 1;
            const validDay = Math.min(payDay, lastDayOfMonth);
            const dueDate = `${year}-${String(month).padStart(2, '0')}-${String(validDay).padStart(2, '0')}`;

            db.query('SELECT id FROM payments WHERE student_id = $1 AND amount = $2 AND due_date = $3',
                [s.id, s.monthly_fee, dueDate], (err, exRes) => {
                    if (!exRes || !exRes.rows || exRes.rows.length === 0) {
                        db.query('INSERT INTO payments (student_id, amount, due_date, status) VALUES ($1, $2, $3, "pendiente")',
                            [s.id, s.monthly_fee, dueDate]);
                    }
                });
        });
        res.json({ success: true, count: students.length });
    });
});

app.get('/api/teacher-payments', authenticateJWT, requireAdmin, (req, res) => {
    const acadId = req.user.academy_id;
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const likePattern = `${year}-${String(month).padStart(2, '0')}%`;

    db.query('SELECT id, name, hourly_rate FROM users WHERE role = "teacher" AND academy_id = $1', [acadId], (err, tRes) => {
        if (err) return res.status(500).json({ error: err.message });
        const teachers = tRes.rows || [];

        let processed = 0;
        if (teachers.length === 0) return res.json([]);

        teachers.forEach(teacher => {
            db.query(`SELECT sum(s.duration_minutes) as ms FROM sessions s JOIN students st ON s.student_id = st.id WHERE st.assigned_teacher_id = $1 AND s.date LIKE $2`,
                [teacher.id, likePattern], (err, sRes) => {
                    const totalMinutes = sRes && sRes.rows && sRes.rows[0] && sRes.rows[0].ms ? parseFloat(sRes.rows[0].ms) : 0;
                    const hours = totalMinutes / 60;
                    const totalAmount = parseFloat((hours * (teacher.hourly_rate || 0)).toFixed(2));

                    db.query('SELECT id, status FROM teacher_payments WHERE teacher_id = $1 AND month = $2 AND year = $3',
                        [teacher.id, month, year], (err, pRes) => {
                            const existing = pRes && pRes.rows && pRes.rows[0];
                            if (existing) {
                                if (existing.status !== 'paid') {
                                    db.query('UPDATE teacher_payments SET hours = $1, hourly_rate = $2, total_amount = $3 WHERE id = $4',
                                        [hours, teacher.hourly_rate || 0, totalAmount, existing.id]);
                                }
                            } else {
                                db.query('INSERT INTO teacher_payments (teacher_id, month, year, hours, hourly_rate, total_amount) VALUES ($1, $2, $3, $4, $5, $6)',
                                    [teacher.id, month, year, hours, teacher.hourly_rate || 0, totalAmount]);
                            }

                            processed++;
                            if (processed === teachers.length) {
                                db.query(`SELECT p.*, u.name as teacher_name 
                                  FROM teacher_payments p 
                                  JOIN users u ON p.teacher_id = u.id 
                                  WHERE u.academy_id = $1 AND month = $2 AND year = $3`, [acadId, month, year], (err, finalRes) => {
                                    if (err) return res.status(500).json({ error: err.message });
                                    res.json(finalRes.rows || []);
                                });
                            }
                        });
                });
        });
    });
});

app.post('/api/teacher-payments/:id/pay', authenticateJWT, requireAdmin, (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    db.query('UPDATE teacher_payments SET status = "paid", paid_at = $1 WHERE id = $2', [today, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.post('/api/admin/send-monthly-report', authenticateJWT, requireAdmin, async (req, res) => {
    // Note: To truly send an email, resend should send it to req.user.email
    // And gather teacher payments. In testing we will mock the logic or use Resend if exists.
    try {
        if (!process.env.RESEND_API_KEY) throw new Error('Resend no configurado');
        const acadId = req.user.academy_id;
        const now = new Date();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();

        const tListRes = await new Promise((resolve, reject) => {
            db.query(`SELECT p.*, u.name as teacher_name 
                      FROM teacher_payments p 
                      JOIN users u ON p.teacher_id = u.id 
                      WHERE u.academy_id = $1 AND month = $2 AND year = $3`,
                [acadId, month, year], (err, r) => err ? reject(err) : resolve(r.rows || []));
        });

        let tableHtml = '<table border="1" cellpadding="5" cellspacing="0" style="width:100%; border-collapse:collapse; text-align:left;">';
        tableHtml += '<tr style="background:#f1f5f9;"><th>Profesor</th><th>Horas</th><th>Tarifa</th><th>Total</th></tr>';
        let grandTotal = 0;
        for (const t of tListRes) {
            tableHtml += `<tr><td>${t.teacher_name}</td><td>${t.hours.toFixed(1)}h</td><td>${t.hourly_rate}€/h</td><td>${t.total_amount}€</td></tr>`;
            grandTotal += t.total_amount;
        }
        tableHtml += `<tr><td colspan="3" align="right"><strong>Total:</strong></td><td><strong>${grandTotal}€</strong></td></tr></table>`;

        await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: 'AcademiaPro <onboarding@resend.dev>',
                to: req.user.email,
                subject: `Resumen mensual de profesores - ${month}/${year}`,
                html: `<h2>Resumen mensual</h2>${tableHtml}`
            })
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Error sending monthly report', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/student/portal-data', authenticateJWT, requireStudent, (req, res) => {
    db.query(`
        SELECT s.*, s.name as student_full_name, u.email as user_email
        FROM students s 
        JOIN users u ON s.user_id = u.id 
        WHERE s.user_id = $1 AND s.academy_id = $2
                `, [req.user.id, req.user.academy_id], (err, result) => {
        const student = result?.rows[0];
        if (err || !student) return res.status(404).json({ error: 'Perfil de estudiante no vinculado' });

        // IMPORTANT: Prioritize the name from the students table (full name set by teacher)
        student.name = student.student_full_name;

        // Ensure defaults for null fields
        student.course = student.course || 'Pendiente de asignar';
        student.subject = student.subject || 'Sin asignatura';

        const data = { student };
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];

        db.query('SELECT s.*, u.name as teacher_name FROM sessions s JOIN students st ON s.student_id = st.id LEFT JOIN users u ON st.assigned_teacher_id = u.id WHERE s.student_id = $1 ORDER BY s.date DESC', [student.id], (err, resSessions) => {
            data.sessions = resSessions?.rows || [];
            db.query('SELECT * FROM exams WHERE student_id = $1 ORDER BY date DESC', [student.id], (err, resExams) => {
                data.exams = resExams?.rows || [];
                db.query('SELECT * FROM payments WHERE student_id = $1 ORDER BY due_date DESC', [student.id], (err, resPayments) => {
                    data.payments = resPayments?.rows || [];

                    // Add stats for dashboard
                    const currentMonth = todayStr.slice(0, 7);
                    const thisMonthSessions = data.sessions.filter(s => s.date.startsWith(currentMonth));

                    data.stats = {
                        nextSession: data.sessions.find(s => s.date >= todayStr) || null,
                        avgScore: data.exams.length > 0 ? (data.exams.reduce((acc, e) => acc + e.score, 0) / data.exams.length).toFixed(1) : 0,
                        pendingPayments: data.payments.filter(p => p.status === 'pending').reduce((acc, p) => acc + p.amount, 0),
                        homeworkRate: thisMonthSessions.length > 0 ? Math.round((thisMonthSessions.filter(s => s.homework_done).length / thisMonthSessions.length) * 100) : 0
                    };

                    res.json(data);
                });
            });
        });
    });
});
app.get('/api/student/reports', authenticateJWT, requireStudent, (req, res) => {
    db.query('SELECT * FROM reports WHERE student_id = (SELECT id FROM students WHERE user_id = $1) ORDER BY year DESC, month DESC', [req.user.id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        const rows = result.rows;
        const monthsNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const formatted = rows.map(r => ({
            ...r,
            monthName: monthsNames[r.month - 1],
            url: r.file_url
        }));
        res.json(formatted);
    });
});

app.get('/api/reports/student/:id', authenticateJWT, (req, res) => {
    db.query('SELECT * FROM reports WHERE student_id = $1 ORDER BY year DESC, month DESC', [req.params.id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        const rows = result.rows;
        const monthsNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const formatted = rows.map(r => ({
            ...r,
            monthName: monthsNames[r.month - 1],
            url: r.file_url
        }));
        res.json(formatted);
    });
});


async function ensureAcademyRooms(academyId) {
    const isPostgres = !!process.env.DATABASE_URL;
    // Ensure "👥 Profesores & Admin" group room exists
    const groupExists = await db.query(
        "SELECT id FROM rooms WHERE academy_id = $1 AND type = 'group' AND name = '👥 Profesores & Admin'",
        [academyId]
    );
    const groupRows = groupExists.rows || groupExists;
    let groupId;

    if (!groupRows || groupRows.length === 0) {
        const insertGroupSql = isPostgres
            ? "INSERT INTO rooms (academy_id, type, name, created_at) VALUES ($1, 'group', '👥 Profesores & Admin', NOW()) RETURNING id"
            : "INSERT INTO rooms (academy_id, type, name, created_at) VALUES ($1, 'group', '👥 Profesores & Admin', datetime('now'))";

        const newGroup = await db.query(insertGroupSql, [academyId]);
        groupId = isPostgres && newGroup.rows ? newGroup.rows[0].id : newGroup.lastID;

        // Let's also delete the old "General Profesores" if it exists so there aren't duplicates
        const oldGroup = await db.query("SELECT id FROM rooms WHERE academy_id = $1 AND type = 'group' AND name = 'General Profesores'", [academyId]);
        const oldRows = oldGroup.rows || oldGroup;
        for (const row of oldRows) {
            await db.query("DELETE FROM room_members WHERE room_id = $1", [row.id]);
            await db.query("DELETE FROM rooms WHERE id = $1", [row.id]);
        }
    } else {
        groupId = groupRows[0].id;
    }

    // Add all teachers and admin to group
    const members = await db.query(
        "SELECT id FROM users WHERE academy_id = $1 AND role IN ('admin','teacher')",
        [academyId]
    );
    const insertMemberSql = isPostgres
        ? "INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
        : "INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES ($1, $2)";

    for (const m of (members.rows || [])) {
        try {
            await db.query(insertMemberSql, [groupId, m.id]);
        } catch (e) { }
    }

    // Create direct rooms for each student with teacher and admin
    // FIX: Look up users with role 'student' directy
    const studentUsers = await db.query(
        `SELECT u.id as user_id, s.id as student_id, s.assigned_teacher_id 
         FROM users u 
         LEFT JOIN students s ON s.academy_id = u.academy_id AND (s.user_id = u.id OR LOWER(s.name) = LOWER(u.name)) 
         WHERE u.academy_id = $1 AND u.role = 'student'`,
        [academyId]
    );

    const admin = await db.query(
        "SELECT id FROM users WHERE academy_id = $1 AND role = 'admin' LIMIT 1",
        [academyId]
    );
    const adminUser = admin.rows && admin.rows[0] ? admin.rows[0] : null;

    for (const student of (studentUsers.rows || [])) {
        const studentUserId = student.user_id;
        if (student.assigned_teacher_id) {
            await createDirectRoomIfNotExists(studentUserId, student.assigned_teacher_id, academyId);
        }
        if (adminUser) {
            await createDirectRoomIfNotExists(studentUserId, adminUser.id, academyId);
        }
    }

    // Create direct rooms for Admin <-> Teachers
    if (adminUser) {
        const teachers = await db.query(
            "SELECT id FROM users WHERE academy_id = $1 AND role = 'teacher'",
            [academyId]
        );
        for (const teacher of (teachers.rows || [])) {
            if (teacher.id !== adminUser.id) {
                await createDirectRoomIfNotExists(teacher.id, adminUser.id, academyId);
            }
        }
    }
}

app.post('/api/chat/ensure-rooms', authenticateJWT, async (req, res) => {
    try {
        await ensureAcademyRooms(req.user.academy_id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/chat/debug-rooms', authenticateJWT, requireAdmin, async (req, res) => {
    try {
        let sql = `
            SELECT r.id, r.type, r.name,
                   (SELECT GROUP_CONCAT(u.name, ', ') FROM room_members rm JOIN users u ON rm.user_id = u.id WHERE rm.room_id = r.id) as members
            FROM rooms r
            WHERE r.academy_id = $1
        `;
        if (!!process.env.DATABASE_URL) {
            sql = `
                SELECT r.id, r.type, r.name,
                       (SELECT STRING_AGG(u.name, ', ') FROM room_members rm JOIN users u ON rm.user_id = u.id WHERE rm.room_id = r.id) as members
                FROM rooms r
                WHERE r.academy_id = $1
            `;
        }
        let result = await db.query(sql, [req.user.academy_id]);
        res.json(result.rows || []);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Chat API - New Rooms Logic
app.get('/api/chat/rooms', authenticateJWT, (req, res) => {
    // Get all rooms the user is member of
    const sql = `
        SELECT r.id, r.type, r.academy_id,
            CASE WHEN r.type = 'group' THEN r.name
                 ELSE (SELECT u.name FROM users u 
                       JOIN room_members rm_sub ON rm_sub.user_id = u.id 
                       WHERE rm_sub.room_id = r.id AND u.id != $1
                       LIMIT 1)
            END as name,
            CASE WHEN r.type = 'direct' THEN 
                 (SELECT u.role FROM users u 
                  JOIN room_members rm_sub ON rm_sub.user_id = u.id 
                  WHERE rm_sub.room_id = r.id AND u.id != $1
                  LIMIT 1)
            END as other_role,
            (SELECT CASE WHEN content = '' OR content IS NULL THEN '📎 Archivo adjunto' ELSE content END FROM messages WHERE room_id = r.id ORDER BY created_at DESC LIMIT 1) as last_message,
            (SELECT created_at FROM messages WHERE room_id = r.id ORDER BY created_at DESC LIMIT 1) as last_message_date,
            (SELECT COUNT(*) FROM messages WHERE room_id = r.id AND read = FALSE AND sender_id != $1) as unread_count,
            r.created_at
        FROM rooms r
        JOIN room_members rm ON r.id = rm.room_id
        WHERE rm.user_id = $2 AND r.academy_id = $3
        ORDER BY last_message_date DESC
    `;
    db.query(sql, [req.user.id, req.user.id, req.user.academy_id], (err, result) => {
        if (err) {
            console.error('Route error:', err.message);
            return res.status(500).json({ error: 'Internal server error', details: err.message });
        }

        // BUG 1 FIX: Deduplication of conversations / duplicate group chats
        const rows = result.rows || result;
        const mapped = [];
        const seenNames = new Set();

        for (const r of rows) {
            if (r.type === 'group') {
                if (seenNames.has(r.name)) continue;
                seenNames.add(r.name);
            }
            if (!mapped.find(x => x.id === r.id)) mapped.push(r);
        }

        res.json(mapped);
    });
});
// IMPLEMENTATION OF FALLBACK AND BUG 2 DIRECT SENDER MESSAGES AS REQUESTED
app.get('/api/chat/messages/:userId', authenticateJWT, async (req, res) => {
    try {
        const sql = `
            SELECT m.*, u.name as sender_name 
            FROM messages m
            LEFT JOIN users u ON u.id = m.sender_id
            WHERE (m.sender_id = $1 AND m.receiver_id = $2)
               OR (m.sender_id = $2 AND m.receiver_id = $1)
            ORDER BY m.created_at ASC
            LIMIT 100
        `;
        const msgs = await db.query(sql, [req.user.id, req.params.userId]);
        res.json(msgs.rows || []);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin backwards compatibility alias
app.get('/api/chat/conversations', authenticateJWT, (req, res) => {
    res.redirect('/api/chat/rooms');
});

app.get('/api/chat/rooms/:roomId/messages', authenticateJWT, async (req, res) => {
    try {
        const roomId = parseInt(req.params.roomId);
        const userId = req.user.id || req.user.userId;

        console.log('Loading messages for room:', roomId, 'user:', userId);

        // Verify user is member of this room
        const membership = await db.query(
            'SELECT id FROM room_members WHERE room_id = $1 AND user_id = $2',
            [roomId, userId]
        );
        const mRows = membership.rows || membership;
        if (!mRows || mRows.length === 0) {
            return res.status(403).json({ error: 'No tienes acceso a esta sala' });
        }

        // Get messages with sender name
        const sql = isPostgres
            ? `SELECT m.id, m.room_id, m.sender_id, m.content, 
              m.file_url, m.file_name, m.created_at, m.read,
              u.name as sender_name
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.room_id = $1
       ORDER BY m.created_at ASC
       LIMIT 100`
            : `SELECT m.id, m.room_id, m.sender_id, m.content, 
              m.file_url, m.file_name, m.created_at, m.read,
              u.name as sender_name
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.room_id = $1
       ORDER BY m.created_at ASC
       LIMIT 100`;

        const messages = await db.query(sql, [roomId]);

        const msgRows = messages.rows || messages;
        console.log('Found', msgRows.length, 'messages for room', roomId);

        res.json(msgRows || []);

    } catch (err) {
        console.error('get messages error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/chat/upload', authenticateJWT, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No hay archivo' });
    const fileUrl = `/ uploads / chat / ${req.file.filename} `;
    res.json({ url: fileUrl, name: req.file.originalname });
});

app.post('/api/chat/mark-read/:roomId', authenticateJWT, (req, res) => {
    db.query('UPDATE messages SET read = TRUE WHERE room_id = $1 AND sender_id != $2', [req.params.roomId, req.user.id], (err) => {
        res.json({ success: true });
    });
});

app.get('/api/chat/unread-count', authenticateJWT, (req, res) => {
    const sql = `
        SELECT COUNT(*) as count FROM messages m
        JOIN room_members rm ON m.room_id = rm.room_id
        WHERE rm.user_id = $1 AND m.sender_id != $2 AND m.read = FALSE AND m.academy_id = $3
    `;
    db.query(sql, [req.user.id, req.user.id, req.user.academy_id], (err, result) => {
        res.json({ count: result?.rows[0]?.count || 0 });
    });
});

const chatUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = path.join(__dirname, 'public/uploads/chat');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, unique + path.extname(file.originalname));
        }
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['application/pdf', 'image/jpeg', 'image/png',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Tipo de archivo no permitido'));
    }
}).single('file');

app.post('/api/chat/upload-file', authenticateJWT, (req, res) => {
    chatUpload(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No file received' });
        res.json({
            file_url: '/uploads/chat/' + req.file.filename,
            file_name: req.file.originalname,
            file_type: req.file.mimetype
        });
    });
});

app.get('/api/academy/codes', authenticateJWT, requireAdmin, (req, res) => {
    db.query('SELECT teacher_code, student_code FROM academies WHERE id = $1', [req.user.academy_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result?.rows[0]);
    });
});

app.post('/api/academy/regenerate', authenticateJWT, requireAdmin, (req, res) => {
    const tCode = generateCode();
    const sCode = generateCode();
    db.query('UPDATE academies SET teacher_code = $1, student_code = $2 WHERE id = $3', [tCode, sCode, req.user.academy_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ teacher_code: tCode, student_code: sCode });
    });
});

// Generic CRUD PUT / DELETE

// --- AI TUTOR / ASSISTANT CONVERSATION HISTORY ---

// List conversations for current user
app.get('/api/ai/conversations', authenticateJWT, (req, res) => {
    db.all('SELECT * FROM ai_conversations WHERE user_id = $1 ORDER BY COALESCE(is_pinned, FALSE) DESC, updated_at DESC', [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Create new conversation
app.post('/api/ai/conversations', authenticateJWT, (req, res) => {
    const { title } = req.body;
    db.query('INSERT INTO ai_conversations (user_id, title) VALUES ($1, $2)', [req.user.id, title || 'Nueva conversación'], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: result.lastID });
    });
});

// Pin conversation
app.put('/api/ai/conversations/:id/pin', authenticateJWT, (req, res) => {
    const { is_pinned } = req.body;
    db.query('UPDATE ai_conversations SET is_pinned = $1 WHERE id = $2 AND user_id = $3', [is_pinned ? 1 : 0, req.params.id, req.user.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Get messages for a conversation
app.get('/api/ai/conversations/:id/messages', authenticateJWT, (req, res) => {
    db.all('SELECT * FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at ASC', [req.params.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Save message to conversation
app.post('/api/ai/conversations/:id/messages', authenticateJWT, (req, res) => {
    const { role, content } = req.body;
    const conversationId = req.params.id;

    db.query('INSERT INTO ai_messages (conversation_id, role, content) VALUES ($1, $2, $3)', [conversationId, role, content], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        // Update conversation title if it's the first message and update updated_at
        db.query('SELECT COUNT(*) as count FROM ai_messages WHERE conversation_id = $1', [conversationId], (err, countRes) => {
            const count = isPostgres ? parseInt(countRes.rows[0].count) : countRes.rows[0].count;
            if (count === 1 && role === 'user') {
                const title = content.substring(0, 50) + (content.length > 50 ? '...' : '');
                db.query('UPDATE ai_conversations SET title = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [title, conversationId]);
            } else {
                db.query('UPDATE ai_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [conversationId]);
            }
        });
        res.json({ success: true });
    });
});

// Delete conversation
app.delete('/api/ai/conversations/:id', authenticateJWT, (req, res) => {
    db.query('DELETE FROM ai_messages WHERE conversation_id = $1', [req.params.id], () => {
        db.query('DELETE FROM ai_conversations WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });
});

// --- EXAM SIMULATOR RESULTS ---

// Save simulator result
app.post('/api/simulator/results', authenticateJWT, (req, res) => {
    const { topic, difficulty, num_questions, score, max_score, percentage, questions_json, answers_json } = req.body;

    db.query('SELECT id FROM students WHERE user_id = $1', [req.user.id], (err, sRes) => {
        const student = sRes?.rows[0];
        if (!student) return res.status(403).json({ error: 'Perfil de estudiante no encontrado' });

        const sql = `INSERT INTO simulator_results 
            (student_id, topic, difficulty, num_questions, score, max_score, percentage, questions_json, answers_json)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
        db.query(sql, [student.id, topic, difficulty, num_questions, score, max_score, percentage, JSON.stringify(questions_json), JSON.stringify(answers_json)], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: result.lastID });
        });
    });
});

// Get simulator results for a student (Teacher/Admin access)
app.get('/api/simulator/results/student/:studentId', authenticateJWT, (req, res) => {
    db.all('SELECT * FROM simulator_results WHERE student_id = $1 ORDER BY created_at DESC', [req.params.studentId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Get single result detail
app.get('/api/simulator/results/:id', authenticateJWT, (req, res) => {
    db.get('SELECT * FROM simulator_results WHERE id = $1', [req.params.id], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Resultado no encontrado' });
        // Parse JSON
        row.questions = JSON.parse(row.questions_json || '[]');
        row.answers = JSON.parse(row.answers_json || '[]');
        res.json(row);
    });
});

// Teacher grade simulator result
app.put('/api/simulator/results/:id/grade', authenticateJWT, requireTeacher, (req, res) => {
    const { teacher_grade, teacher_feedback } = req.body;
    const sql = 'UPDATE simulator_results SET teacher_grade = $1, teacher_feedback = $2, graded_at = CURRENT_TIMESTAMP WHERE id = $3';
    db.query(sql, [teacher_grade, teacher_feedback, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// --- STUDENT EXAM MANAGEMENT ---

// GET exams for current student
app.get('/api/exams/student', authenticateJWT, (req, res) => {
    db.query('SELECT id FROM students WHERE user_id = $1', [req.user.id], (err, sRes) => {
        const student = sRes?.rows[0];
        if (!student) return res.status(403).json({ error: 'Perfil de estudiante no encontrado' });

        db.all('SELECT * FROM exams WHERE student_id = $1 ORDER BY date DESC', [student.id], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });
});

// POST new exam (student adding it)
app.post('/api/exams/student', authenticateJWT, (req, res) => {
    const { subject, date, score, notes } = req.body;
    console.log(`[ExamSave] Student ${req.user.id} attempting to save exam:`, { subject, date, score });

    db.query('SELECT id, academy_id, assigned_teacher_id, name FROM students WHERE user_id = $1', [req.user.id], (err, sRes) => {
        if (err) {
            console.error('[ExamSave] Student lookup error:', err);
            return res.status(500).json({ error: 'Database error searching for student profile' });
        }

        const student = sRes?.rows[0];
        if (!student) {
            console.error('[ExamSave] Student profile not found for user ID:', req.user.id);
            return res.status(403).json({ error: 'Tu usuario no tiene un perfil de estudiante vinculado.' });
        }

        console.log(`[ExamSave] Found student profile: ${student.id}, Name: ${student.name}`);

        db.query('INSERT INTO exams (student_id, subject, date, score, notes) VALUES ($1, $2, $3, $4, $5)', [student.id, subject, date, score, notes], (err, result) => {
            if (err) {
                console.error('[ExamSave] Insert exam error:', err);
                return res.status(500).json({ error: 'Error al insertar el examen en la base de datos: ' + err.message });
            }

            const examId = result.lastID;
            console.log(`[ExamSave] Exam saved successfully with ID: ${examId}`);

            // Automatically add to teacher's calendar as a red event if teacher is assigned
            if (student.assigned_teacher_id) {
                console.log(`[ExamSave] Student has teacher assigned (${student.assigned_teacher_id}). Attempting calendar sync...`);
                try {
                    const startTime = `${date}T09:00:00`;
                    const endTime = `${date}T10:00:00`;
                    const title = `📝 Examen: ${subject} - ${student.name}`;

                    // We don't await/callback here to avoid blocking student save if calendar fails
                    db.query('INSERT INTO available_slots (teacher_id, academy_id, start_datetime, end_datetime, is_booked, student_id, notes) VALUES ($1, $2, $3, $4, 1, $5, $6)',
                        [student.assigned_teacher_id, student.academy_id, startTime, endTime, student.id, title], (calErr) => {
                            if (calErr) console.error('[ExamSave] Teacher calendar event creation failed:', calErr);
                            else console.log('[ExamSave] Teacher calendar event created successfully.');
                        });
                } catch (calCatch) {
                    console.error('[ExamSave] Exception in calendar sync block:', calCatch);
                }
            } else {
                console.log('[ExamSave] No teacher assigned, skipping calendar sync.');
            }

            // Trigger risk detection if score added
            if (score !== null) {
                console.log('[ExamSave] Score provided, triggering risk detection...');
                try {
                    checkStudentRisk(student.id);
                } catch (riskErr) {
                    console.error('[ExamSave] Risk detection failed:', riskErr);
                }
            }

            res.json({ success: true, id: examId });
        });
    });
});

// Update score for existing exam (especially for future exams that just happened)
app.put('/api/exams/:id/score', authenticateJWT, (req, res) => {
    const { score } = req.body;
    db.query('UPDATE exams SET score = $1 WHERE id = $2', [score, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        db.query('SELECT student_id FROM exams WHERE id = $1', [req.params.id], (err, resId) => {
            const studentId = resId?.rows[0]?.student_id;
            if (studentId) checkStudentRisk(studentId);
        });

        res.json({ success: true });
    });
});


['students', 'sessions', 'exams', 'payments'].forEach(tableName => {
    app.put(`/api/${tableName}/:id`, authenticateJWT, (req, res) => {
        const keys = Object.keys(req.body);
        const values = [...Object.values(req.body), req.params.id];
        const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(',');
        db.query(`UPDATE ${tableName} SET ${setClause} WHERE id = $${keys.length + 1}`, values, (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            if (tableName === 'sessions' || tableName === 'exams') {
                db.query(`SELECT student_id FROM ${tableName} WHERE id = $1`, [req.params.id], (err, resId) => {
                    const row = resId?.rows[0];
                    if (row) checkStudentRisk(row.student_id);
                });
            }
            res.json({ updated: result.rowCount });
        });
    });
    app.delete(`/api/${tableName}/:id`, authenticateJWT, (req, res) => {
        db.query(`DELETE FROM ${tableName} WHERE id = $1`, [req.params.id], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ deleted: result.rowCount });
        });
    });
});

// Settings API
app.get('/api/settings', authenticateJWT, (req, res) => {
    db.all("SELECT * FROM settings", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const settings = {};
        rows.forEach(r => settings[r.key] = r.value);
        res.json(settings);
    });
});

app.post('/api/settings', authenticateJWT, requireAdmin, async (req, res) => {
    const settings = req.body;
    try {
        for (const [key, val] of Object.entries(settings)) {
            const sql = isPostgres
                ? "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
                : "INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)";
            await db.query(sql, [key, String(val)]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// AI Report Generation
app.post('/api/generate-report', authenticateJWT, async (req, res) => {
    try {
        const { studentId, month, year, observations, sendEmail } = req.body;
        const monthNum = parseInt(month);
        const yearNum = parseInt(year);
        const monthStr = monthNum < 10 ? `0${monthNum}` : `${monthNum}`;
        const datePrefix = `${yearNum}-${monthStr}`;
        const monthsNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const monthText = monthsNames[monthNum - 1];

        db.query(`SELECT * FROM students WHERE id = $1`, [studentId], async (err, resStudent) => {
            const student = resStudent?.rows[0];
            if (err || !student) return res.status(404).json({ error: 'Estudiante no encontrado' });

            db.query(`SELECT * FROM sessions WHERE student_id = $1 AND date LIKE $2`, [studentId, `${datePrefix}%`], async (err, resSessions) => {
                db.query(`SELECT * FROM exams WHERE student_id = $1 AND date LIKE $2`, [studentId, `${datePrefix}%`], async (err, resExams) => {
                    db.query(`SELECT * FROM simulator_results WHERE student_id = $1 AND created_at LIKE $2`, [studentId, `${datePrefix}%`], async (err, resSims) => {
                        const sessions = resSessions?.rows || [];
                        const exams = resExams?.rows || [];
                        const sims = resSims?.rows || [];

                        const sessionCount = sessions.length;
                        const homeworkCount = sessions.filter(s => s.homework_done).length;
                        const homeworkRate = sessionCount > 0 ? ((homeworkCount / sessionCount) * 100).toFixed(0) : 0;
                        const examDetails = exams.map(e => `${e.subject}: ${e.score}${e.score === null ? ' (Pendiente)' : ''}`).join(', ');
                        const simDetails = sims.map(s => `${s.topic} (${s.percentage}%)${s.teacher_grade ? ' - Nota Profesor: ' + s.teacher_grade : ''}`).join(', ');

                        if (sendEmail) {
                            const checkSentRes = await new Promise(resolve => {
                                db.query('SELECT id FROM sent_reports WHERE student_id = $1 AND month = $2 AND year = $3 AND academy_id = $4 LIMIT 1',
                                    [studentId, monthNum, yearNum, student.academy_id], (err, r) => resolve(r?.rows[0]));
                            });
                            if (checkSentRes) {
                                return res.status(400).json({ error: 'Ya se ha enviado un informe mensual a este alumno para el mes especificado. Espera al mes siguiente o elimínalo manualmente de la Base de Datos.' });
                            }
                        }

                        const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
                        try {
                            const chatCompletion = await groqClient.chat.completions.create({
                                messages: [
                                    {
                                        role: "system",
                                        content: "Eres el asistente de una academia de repaso española. Genera un informe mensual profesional y cercano para la familia del alumno. Tono cálido pero profesional, como un tutor de confianza. Estructura: saludo personalizado, resumen positivo del mes (mencionando asistencia y tareas), análisis de exámenes y simulacros, áreas de mejora con tacto, próximos objetivos, cierre motivador. Máximo 250 palabras. Siempre en español."
                                    },
                                    {
                                        role: "user",
                                        content: `Estudiante: ${student.name}, Curso: ${student.course}, Asignatura: ${student.subject}. Sesiones este mes: ${sessionCount}. Tareas completadas: ${homeworkRate}%. Notas exámenes: ${examDetails || 'Ninguno'}. Simulacros realizados: ${simDetails || 'Ninguno'}. Observaciones del profesor: ${observations}`
                                    }
                                ],
                                model: "llama-3.3-70b-versatile",
                            });

                            const reportText = chatCompletion.choices[0].message.content;

                            const doc = new PDFDocument();
                            let buffers = [];
                            doc.on('data', buffers.push.bind(buffers));
                            doc.on('end', async () => {
                                let pdfData = Buffer.concat(buffers);
                                const fileName = `informe_${student.name.replace(/ /g, '_')}_${monthNum}_${yearNum}_${Date.now()}.pdf`;
                                const reportsDir = path.join(__dirname, 'public/uploads/reports');
                                if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
                                const filePath = path.join(reportsDir, fileName);
                                fs.writeFileSync(filePath, pdfData);

                                const fileUrl = `/uploads/reports/${fileName}`;
                                db.query('INSERT INTO reports (student_id, academy_id, month, year, file_url) VALUES ($1, $2, $3, $4, $5)',
                                    [studentId, student.academy_id, monthNum, yearNum, fileUrl]);

                                let emailStatus = { sent: false };
                                if (sendEmail && student.parent_email) {
                                    const resend = new Resend(process.env.RESEND_API_KEY);
                                    try {
                                        await resend.emails.send({
                                            from: 'AcademiaPro <onboarding@resend.dev>',
                                            to: student.parent_email,
                                            subject: `Informe mensual de ${student.name} - ${monthText} ${yearNum}`,
                                            html: `Estimada familia,<br><br>Adjuntamos el informe mensual de <b>${student.name}</b> correspondiente a ${monthText} ${yearNum}.<br><br>Quedamos a su disposición para cualquier consulta.<br><br>Un saludo,<br>El equipo de AcademiaPro`,
                                            attachments: [
                                                {
                                                    filename: fileName,
                                                    content: pdfData,
                                                },
                                            ],
                                        });
                                        emailStatus.sent = true;
                                        emailStatus.to = student.parent_email;

                                        // Register sent report
                                        db.query('INSERT INTO sent_reports (academy_id, student_id, month, year) VALUES ($1, $2, $3, $4)',
                                            [student.academy_id, studentId, monthNum, yearNum]);

                                    } catch (eError) {
                                        console.error('Resend Email Error:', eError);
                                        emailStatus.error = eError.message;
                                    }
                                }

                                res.setHeader('Content-Type', 'application/pdf');
                                res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
                                res.setHeader('X-Email-Status', JSON.stringify(emailStatus));
                                res.send(pdfData);
                            });

                            // Header Rectangle
                            doc.rect(0, 0, 612, 100).fill('#1A56A0');
                            doc.fillColor('white').fontSize(24).text('AcademiaPro', 50, 40);
                            doc.fontSize(14).text(`Informe Mensual - ${monthText} ${yearNum}`, 400, 45);

                            // Body
                            doc.fillColor('black').fontSize(12).moveDown(5);
                            doc.fontSize(16).text(`Estudiante: ${student.name}`, { underline: true });
                            doc.fontSize(12).text(`Curso: ${student.course} | Asignatura: ${student.subject}`);

                            doc.moveDown(2);
                            doc.fontSize(11).text(reportText, { align: 'justify', lineGap: 5 });

                            // Section: Exams
                            if (exams.length > 0) {
                                doc.moveDown();
                                doc.fontSize(14).text('Exámenes del mes', { underline: true });
                                exams.forEach(e => {
                                    doc.fontSize(11).text(`• ${e.subject}: ${e.score || 'Pendiente'}`);
                                });
                            }

                            // Section: Simulators
                            if (sims.length > 0) {
                                doc.moveDown();
                                doc.fontSize(14).text('Simulacros del mes', { underline: true });
                                sims.forEach(s => {
                                    let simText = `• ${s.topic}: ${s.percentage}%`;
                                    if (s.teacher_grade) simText += ` (Nota Profesor: ${s.teacher_grade}/10)`;
                                    doc.fontSize(11).text(simText);
                                });
                            }

                            // Footer
                            doc.moveDown(4);
                            doc.fillColor('#64748b').fontSize(10).text('Generado por AcademiaPro', { align: 'center' });

                            doc.end();

                        } catch (apiError) {
                            console.error('Groq API Error:', apiError);
                            res.status(500).json({ error: 'Error al generar el informe con IA' });
                        }
                    });
                });
            });
        });
    } catch (err) {
        console.error('Route error:', err.message);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
});

// Socket.io for Real-time chat
io.on('error', (err) => console.error('Socket error:', err));
io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);

    socket.on('authenticate', (token) => {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_jwt');
            socket.userId = decoded.id || decoded.userId;
            console.log('Socket authenticated, userId:', socket.userId);
            socket.emit('authenticated', { success: true, userId: socket.userId });
        } catch (e) {
            console.log('Socket auth failed:', e.message);
            socket.emit('authenticated', { success: false });
        }
    });

    socket.on('join_academy', (academyId) => {
        socket.join(`academy_${academyId}`);
    });

    socket.on('join_rooms', (roomIds) => {
        roomIds.forEach(id => socket.join(`room_${id}`));
    });

    socket.on('join_room', (roomId) => {
        const roomName = 'room_' + roomId;
        socket.join(roomName);
        console.log('Socket', socket.userId, 'joined room:', roomName);
    });

    socket.on('disconnect', () => {
        console.log('Socket disconnected:', socket.userId);
    });

    const handleSendMessage = async (data) => {
        console.log('send_message received:', data);
        console.log('socket.userId:', socket.userId);

        try {
            const { room_id, content, file_url, file_name } = data;
            const sender_id = socket.userId;

            if (!sender_id) {
                console.log('ERROR: no sender_id on socket');
                return;
            }

            // Get user info
            const userResult = await db.query(
                'SELECT id, name, academy_id FROM users WHERE id = $1',
                [sender_id]
            );
            const userRows = userResult.rows || userResult;
            const user = userRows[0];

            if (!user) {
                console.log('ERROR: user not found for id:', sender_id);
                return;
            }

            console.log('Saving message from user:', user.name, 'to room:', room_id);

            // Save to database
            const insertSql = isPostgres
                ? `INSERT INTO messages 
                (room_id, sender_id, content, file_url, file_name, academy_id, read, created_at) 
                VALUES ($1, $2, $3, $4, $5, $6, 0, NOW()) RETURNING id`
                : `INSERT INTO messages 
                (room_id, sender_id, content, file_url, file_name, academy_id, read, created_at) 
                VALUES ($1, $2, $3, $4, $5, $6, 0, datetime('now'))`;

            const result = await db.query(insertSql, [room_id, sender_id, content || '', file_url || null, file_name || null, user.academy_id]);

            const messageId = isPostgres && result?.rows ? result.rows[0].id : result.lastID;
            console.log('Message saved with id:', messageId);

            // Emit to room
            const messageData = {
                id: messageId,
                room_id: parseInt(room_id),
                sender_id: sender_id,
                sender_name: user.name,
                content: content || '',
                file_url: file_url || null,
                file_name: file_name || null,
                created_at: new Date().toISOString(),
                read: 0
            };

            console.log('Emitting to room_' + room_id, messageData);
            io.to('room_' + room_id).emit('new_message', messageData);

        } catch (err) {
            console.error('send_message error:', err);
        }
    };

    socket.on('sendMessage', handleSendMessage);
    socket.on('send_message', handleSendMessage);

    socket.on('typing', (data) => {
        socket.to(`room_${data.room_id}`).emit('typing', { room_id: data.room_id, user_name: data.user_name });
    });
});

async function ensureAllChatRooms() {
    if (global.roomsEnsured) return;
    global.roomsEnsured = true;
    try {
        const academies = await db.query('SELECT id FROM academies');
        const academyRows = academies.rows || academies;
        for (const academy of academyRows) {
            await ensureAcademyRooms(academy.id);
        }
        console.log('✅ Chat rooms ensured for all academies');
    } catch (err) {
        console.error('ensureAllChatRooms error:', err);
    }
}

async function createDirectRoomIfNotExists(u1, u2, academyId) {
    const isPostgres = !!process.env.DATABASE_URL;
    const exists = await db.query(
        `SELECT r.id FROM rooms r
         JOIN room_members rm1 ON rm1.room_id = r.id AND rm1.user_id = $1
         JOIN room_members rm2 ON rm2.room_id = r.id AND rm2.user_id = $2
         WHERE r.type = 'direct' AND r.academy_id = $3`,
        [u1, u2, academyId]
    );
    if (!exists.rows || exists.rows.length === 0) {
        const insertSql = isPostgres
            ? "INSERT INTO rooms (academy_id, type, name, created_at) VALUES ($1, 'direct', 'Direct', NOW()) RETURNING id"
            : "INSERT INTO rooms (academy_id, type, name, created_at) VALUES ($1, 'direct', 'Direct', datetime('now'))";
        const newR = await db.query(insertSql, [academyId]);
        const nrId = isPostgres && newR.rows ? newR.rows[0].id : newR.lastID;

        const insertMemberSql = isPostgres
            ? "INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
            : "INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES ($1, $2)";

        await db.query(insertMemberSql, [nrId, u1]);
        await db.query(insertMemberSql, [nrId, u2]);
    }
}

db.initDb().then(async () => {
    server.listen(PORT, () => {
        console.log('Server running on port ' + PORT);

        console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
        console.log('NODE_ENV:', process.env.NODE_ENV);
        console.log('DB TYPE:', process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('your_postgres') ? 'PostgreSQL' : 'SQLite');

        // ensureAllChatRooms(); // Disabled to fix duplicates
        initCrons();
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
});
