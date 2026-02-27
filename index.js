require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./db');
const PDFDocument = require('pdfkit');
const Groq = require("groq-sdk");
const { Resend } = require('resend');
const path = require('path');
const fs = require('fs');

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
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e7 // 10MB
});
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

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'dummy',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'dummy',
    callbackURL: process.env.NODE_ENV === 'production'
        ? 'https://web-production-d02f4.up.railway.app/auth/google/callback'
        : 'http://localhost:3000/auth/google/callback'
},
    (accessToken, refreshToken, profile, cb) => {
        db.query('SELECT * FROM users WHERE google_id = $1 OR email = $2', [profile.id, profile.emails[0].value], (err, result) => {
            if (err) return cb(err);
            const user = result?.rows[0];
            if (user) {
                // Update google id if not set
                if (!user.google_id) db.query('UPDATE users SET google_id = $1 WHERE id = $2', [profile.id, user.id]);
                return cb(null, user);
            } else {
                // New user via Google -> becomes an admin with a new academy by default
                const academyName = `${profile.displayName}'s Academy`;
                const tCode = generateCode();
                const sCode = generateCode();
                db.query('INSERT INTO academies (name, teacher_code, student_code) VALUES ($1, $2, $3)', [academyName, tCode, sCode], (err, res) => {
                    if (err) return cb(err);
                    const acadId = res.lastID;
                    db.query('INSERT INTO users (name, email, google_id, role, academy_id) VALUES ($1, $2, $3, $4, $5)',
                        [profile.displayName, profile.emails[0].value, profile.id, 'admin', acadId], (err, res2) => {
                            if (err) return cb(err);
                            const user = { id: res2.lastID, name: profile.displayName, role: 'admin', academy_id: acadId };
                            db.query('UPDATE academies SET owner_id = $1 WHERE id = $2', [user.id, acadId]);
                            return cb(null, user);
                        });
                });
            }
        });
    }
));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// API Authentication Middlewares
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt';

const authenticateJWT = (req, res, next) => {
    const token = req.cookies.token;
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
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public/login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public/register.html')));
app.get('/join', (req, res) => res.sendFile(path.join(__dirname, 'public/join.html')));

app.post('/auth/register', (req, res) => {
    const { name, email, password, academy_name } = req.body;
    const hash = bcrypt.hashSync(password, 8);
    const tCode = generateCode();
    const sCode = generateCode();

    db.query('INSERT INTO academies (name, teacher_code, student_code) VALUES ($1, $2, $3)', [academy_name, tCode, sCode], (err, res1) => {
        if (err) return res.status(500).json({ error: err.message });
        const acadId = res1.lastID;
        db.query('INSERT INTO users (name, email, password_hash, role, academy_id) VALUES ($1, $2, $3, $4, $5)',
            [name, email, hash, 'admin', acadId], (err, res2) => {
                if (err) return res.status(500).json({ error: err.message });
                const userId = res2.lastID;
                db.query('UPDATE academies SET owner_id = $1 WHERE id = $2', [userId, acadId]);

                // Auto create "General Profesores" on academy creation
                db.query('INSERT INTO rooms (academy_id, type, name) VALUES ($1, "group", "General Profesores")', [acadId], (err, res3) => {
                    if (!err) {
                        const roomId = res3.lastID;
                        db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, userId]);
                    }
                });

                res.json({ success: true, teacher_code: tCode, student_code: sCode });
            });
    });
});

app.post('/auth/login', (req, res) => {
    const { email, password } = req.body;
    db.query('SELECT * FROM users WHERE email = $1', [email], (err, result) => {
        const user = result?.rows[0];
        if (err || !user || !bcrypt.compareSync(password, user.password_hash)) {
            return res.redirect('/login');
        }
        const token = jwt.sign({ id: user.id, role: user.role, academy_id: user.academy_id, name: user.name }, JWT_SECRET, { expiresIn: '1d' });
        res.cookie('token', token, { httpOnly: true });
        if (user.role === 'admin') res.redirect('/');
        else if (user.role === 'teacher') res.redirect('/teacher/dashboard');
        else res.redirect('/student-portal');
    });
});

app.post('/auth/join', (req, res) => {
    const { code, name, email, password } = req.body;
    db.query('SELECT * FROM academies WHERE teacher_code = $1 OR student_code = $2', [code, code], (err, result) => {
        const acad = result?.rows[0];
        if (err || !acad) return res.status(404).json({ error: 'Invalid code' });
        const role = code === acad.teacher_code ? 'teacher' : 'student';
        const hash = bcrypt.hashSync(password, 8);
        db.query('INSERT INTO users (name, email, password_hash, role, academy_id) VALUES ($1, $2, $3, $4, $5)',
            [name, email, hash, role, acad.id], (err, resInsert) => {
                if (err) return res.status(500).json({ error: err.message });
                const userId = resInsert.lastID;

                if (role === 'student') {
                    // Try to match with existing student record
                    db.query('SELECT id FROM students WHERE name = $1 AND academy_id = $2 AND user_id IS NULL', [name, acad.id], (err, resMatch) => {
                        const existing = resMatch?.rows[0];
                        if (existing) {
                            db.query('UPDATE students SET user_id = $1 WHERE id = $2', [userId, existing.id]);
                        } else {
                            db.query('INSERT INTO students (name, parent_email, academy_id, user_id, join_date) VALUES ($1, $2, $3, $4, $5)',
                                [name, email, acad.id, userId, new Date().toISOString().split('T')[0]]);
                        }
                    });

                    // Create direct chat with Admin
                    db.query('INSERT INTO rooms (academy_id, type) VALUES ($1, "direct")', [acad.id], (err, resRoom) => {
                        if (!err) {
                            const roomId = resRoom.lastID;
                            db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, userId]);
                            db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, acad.owner_id]);
                        }
                    });
                } else if (role === 'teacher') {
                    // Create direct chat with Admin
                    db.query('INSERT INTO rooms (academy_id, type) VALUES ($1, "direct")', [acad.id], (err, resRoom) => {
                        if (!err) {
                            const roomId = resRoom.lastID;
                            db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, userId]);
                            db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, acad.owner_id]);
                        }
                    });
                    // Join General Profesores
                    db.query('SELECT id FROM rooms WHERE academy_id = $1 AND type = "group" AND name = "General Profesores"', [acad.id], (err, resGroup) => {
                        const room = resGroup?.rows[0];
                        if (room) {
                            db.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [room.id, userId]);
                        }
                    });
                }
                res.json({ success: true });
            });
    });
});

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), (req, res) => {
    const user = req.user;
    const token = jwt.sign({ id: user.id, role: user.role, academy_id: user.academy_id, name: user.name }, JWT_SECRET, { expiresIn: '1d' });
    res.cookie('token', token, { httpOnly: true });
    if (user.role === 'admin') res.redirect('/');
    else if (user.role === 'teacher') res.redirect('/teacher/dashboard');
    else res.redirect('/student-portal');
});

app.get('/auth/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/login');
});

app.get('/auth/me', authenticateJWT, (req, res) => {
    res.json(req.user);
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
app.get('/students', authenticateJWT, requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public/students.html')));
app.get('/sessions', authenticateJWT, (req, res) => res.sendFile(path.join(__dirname, 'public/sessions.html')));
app.get('/calendar', authenticateJWT, (req, res) => res.sendFile(path.join(__dirname, 'public/calendar.html')));
app.get('/exams', authenticateJWT, (req, res) => res.sendFile(path.join(__dirname, 'public/exams.html')));
app.get('/payments', authenticateJWT, (req, res) => res.sendFile(path.join(__dirname, 'public/payments.html')));
app.get('/settings', authenticateJWT, requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public/settings.html')));
app.get('/chat', authenticateJWT, (req, res) => res.sendFile(path.join(__dirname, 'public/chat.html')));
app.get('/student/:id', authenticateJWT, (req, res) => {
    if (req.user.role === 'admin') {
        res.sendFile(path.join(__dirname, 'public/student_profile.html'));
    } else if (req.user.role === 'teacher') {
        // Checking assignment logic is better handled in the API and also here for visual safety
        db.query('SELECT id FROM students WHERE id = $1 AND assigned_teacher_id = $2', [req.params.id, req.user.id], (err, result) => {
            const row = result?.rows[0];
            if (row) res.sendFile(path.join(__dirname, 'public/teacher_student_profile.html'));
            else res.redirect('/teacher/dashboard');
        });
    } else {
        res.redirect('/student-portal');
    }
});

// Teacher Scoped Pages
app.get('/teacher/sessions', authenticateJWT, requireTeacher, (req, res) => res.sendFile(path.join(__dirname, 'public/teacher_sessions.html')));
app.get('/teacher/exams', authenticateJWT, requireTeacher, (req, res) => res.sendFile(path.join(__dirname, 'public/teacher_exams.html')));
app.get('/teacher/calendar', authenticateJWT, requireTeacher, (req, res) => res.sendFile(path.join(__dirname, 'public/teacher_calendar.html')));

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

app.get('/api/admin/unassigned-count', authenticateJWT, requireAdmin, (req, res) => {
    db.query('SELECT COUNT(*) as count FROM students WHERE academy_id = $1 AND assigned_teacher_id IS NULL', [req.user.academy_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ count: result.rows[0]?.count || 0 });
    });
});
app.post('/api/students', authenticateJWT, requireAdmin, (req, res) => {
    const keys = Object.keys(req.body);
    const values = Object.values(req.body);
    keys.push('academy_id');
    values.push(req.user.academy_id);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(',');
    const sql = `INSERT INTO students (${keys.join(',')}) VALUES (${placeholders})`;
    db.query(sql, values, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id: result.lastID, ...req.body });
    });
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
app.post('/api/sessions', authenticateJWT, (req, res) => {
    const keys = Object.keys(req.body);
    const values = Object.values(req.body);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(',');
    const sql = `INSERT INTO sessions (${keys.join(',')}) VALUES (${placeholders})`;
    db.query(sql, values, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (req.body.student_id) checkStudentRisk(req.body.student_id);
        res.status(201).json({ id: result.lastID, ...req.body });
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
        SELECT p.*, s.name as student_name
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

app.get('/api/student/portal-data', authenticateJWT, requireStudent, (req, res) => {
    db.query(`
        SELECT s.*, u.name as full_name 
        FROM students s 
        JOIN users u ON s.user_id = u.id 
        WHERE s.user_id = $1 AND s.academy_id = $2
    `, [req.user.id, req.user.academy_id], (err, result) => {
        const student = result?.rows[0];
        if (err || !student) return res.status(404).json({ error: 'Perfil de estudiante no vinculado' });

        // IMPORTANT: Use the name from the users table as the display name
        student.name = student.full_name;

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

// Chat API - New Rooms Logic
app.get('/api/chat/rooms', authenticateJWT, (req, res) => {
    // Get all rooms the user is member of
    const sql = `
        SELECT r.*, 
        (SELECT content FROM messages WHERE room_id = r.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages WHERE room_id = r.id ORDER BY created_at DESC LIMIT 1) as last_message_date,
        (SELECT COUNT(*) FROM messages WHERE room_id = r.id AND read = FALSE AND sender_id != $1) as unread_count
        FROM rooms r
        JOIN room_members rm ON r.id = rm.room_id
        WHERE rm.user_id = $2 AND r.academy_id = $3
        ORDER BY last_message_date DESC
    `;
    db.query(sql, [req.user.id, req.user.id, req.user.academy_id], async (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        const rooms = result.rows;

        // Enrich direct rooms with the other user's info
        const enrichedRooms = await Promise.all(rooms.map(async (room) => {
            if (room.type === 'direct') {
                const otherUser = await new Promise((resolve) => {
                    db.query(`SELECT u.name, u.role FROM users u 
                            JOIN room_members rm ON u.id = rm.user_id 
                            WHERE rm.room_id = $1 AND u.id != $2`, [room.id, req.user.id], (err, resOther) => resolve(resOther?.rows[0]));
                });
                return { ...room, name: otherUser?.name || 'Usuario', other_role: otherUser?.role };
            }
            return room;
        }));

        res.json(enrichedRooms);
    });
});

app.get('/api/chat/messages/:roomId', authenticateJWT, (req, res) => {
    const roomId = req.params.roomId;
    // Check membership
    db.query('SELECT * FROM room_members WHERE room_id = $1 AND user_id = $2', [roomId, req.user.id], (err, resultMem) => {
        const rm = resultMem?.rows[0];
        if (!rm) return res.status(403).json({ error: 'No tienes acceso a esta sala' });

        db.query(`SELECT m.*, u.name as sender_name, u.role as sender_role 
                FROM messages m 
                JOIN users u ON m.sender_id = u.id 
                WHERE m.room_id = $1 ORDER BY m.created_at ASC`, [roomId], (err, resultItems) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(resultItems.rows);
        });
    });
});

app.post('/api/chat/upload', authenticateJWT, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No hay archivo' });
    const fileUrl = `/uploads/chat/${req.file.filename}`;
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
                const sessions = resSessions?.rows || [];
                const exams = resExams?.rows || [];

                const sessionCount = sessions.length;
                const homeworkCount = sessions.filter(s => s.homework_done).length;
                const homeworkRate = sessionCount > 0 ? ((homeworkCount / sessionCount) * 100).toFixed(0) : 0;
                const examDetails = exams.map(e => `${e.subject}: ${e.score}`).join(', ');

                const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
                try {
                    const chatCompletion = await groq.chat.completions.create({
                        messages: [
                            {
                                role: "system",
                                content: "Eres el asistente de una academia de repaso española. Genera un informe mensual profesional y cercano para la familia del alumno. Tono cálido pero profesional, como un tutor de confianza. Estructura: saludo personalizado, resumen positivo del mes, áreas de mejora con tacto, próximos objetivos, cierre motivador. Máximo 250 palabras. Siempre en español."
                            },
                            {
                                role: "user",
                                content: `Estudiante: ${student.name}, Curso: ${student.course}, Asignatura: ${student.subject}. Sesiones este mes: ${sessionCount}. Tareas completadas: ${homeworkRate}%. Notas exámenes: ${examDetails || 'Ninguno'}. Observaciones del profesor: ${observations}`
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

// Socket.io for Real-time chat
io.on('connection', (socket) => {
    socket.on('join_academy', (academyId) => {
        socket.join(`academy_${academyId}`);
    });

    socket.on('join_rooms', (roomIds) => {
        roomIds.forEach(id => socket.join(`room_${id}`));
    });

    socket.on('sendMessage', (data) => {
        const { academy_id, room_id, sender_id, content, file_url, file_name } = data;
        const insertSql = isPostgres
            ? 'INSERT INTO messages (academy_id, room_id, sender_id, content, file_url, file_name) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id'
            : 'INSERT INTO messages (academy_id, room_id, sender_id, content, file_url, file_name) VALUES ($1, $2, $3, $4, $5, $6)';

        db.query(insertSql, [academy_id, room_id, sender_id, content, file_url, file_name], (err, result) => {
            if (!err) {
                const messageId = result.lastID;
                db.query('SELECT m.*, u.name as sender_name, u.role as sender_role FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = $1', [messageId], (err, resMsg) => {
                    const msg = resMsg?.rows[0];
                    if (msg) io.to(`room_${room_id}`).emit('new_message', msg);
                });
            }
        });
    });

    socket.on('typing', (data) => {
        socket.to(`room_${data.room_id}`).emit('typing', { room_id: data.room_id, user_name: data.user_name });
    });
});

server.listen(PORT, () => console.log(`Server is running on http://localhost:${PORT}`));
