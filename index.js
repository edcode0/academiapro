require('dotenv').config();

// ─── Sentry error tracking (must be first) ───────────────────────────────────
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'production',
        tracesSampleRate: 0.1
    });
    console.log('[Sentry] Initialized for environment:', process.env.NODE_ENV || 'production');
} else {
    console.log('[Sentry] SENTRY_DSN not set — error tracking disabled');
}
// ─────────────────────────────────────────────────────────────────────────────

console.log('=== DB CHECK ===');
console.log('Database configured:', !!process.env.DATABASE_URL);

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err.message, err.stack);
    Sentry.captureException(err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
    Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
    process.exit(1);
});

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const db = require('./db');

// Call database initialization on startup
async function initializeDatabase() {
    console.log('Initializing database...');
    try {
        await db.initDb();
        console.log('Database initialized successfully using db.js schema');
    } catch (err) {
        console.error('Database initialization error:', err.message);
        Sentry.captureException(err);
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

// Auth Requires
const jwt = require('jsonwebtoken');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const cookieParser = require('cookie-parser');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
app.get('/health', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.json({ status: 'ok', uptime: process.uptime() });
    } catch (err) {
        res.status(500).json({ status: 'error' });
    }
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    maxHttpBufferSize: 1e7 // 10MB
});
const { createNotification, setIo: setNotifIo } = require('./notifications');
const calendarRouter        = require('./routes/calendar');
const studentsRouter        = require('./routes/students');
const sessionsRouter        = require('./routes/sessions');
const paymentsRouter        = require('./routes/payments');
const teachersRouter        = require('./routes/teachers');
const examsRouter           = require('./routes/exams');
const makeChatRouter        = require('./routes/chat');
const authRouter            = require('./routes/auth');
const aiRouter              = require('./routes/ai');
const notificationsRouter   = require('./routes/notifications');
const reportsRouter         = require('./routes/reports');
const settingsRouter        = require('./routes/settings');
const makeTranscriptsRouter = require('./routes/transcripts');
setNotifIo(io);

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('No token'));
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = user;
    next();
  } catch(e) {
    next(new Error('Invalid token'));
  }
});

const isPostgres = !!process.env.DATABASE_URL;

global.roomsEnsured = false;

const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY || 'dummy' });
const { google } = require('googleapis');

// ─── Gmail transcript auto-processor ─────────────────────────────────────────
function makeOAuth2Client() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        (process.env.BASE_URL || '') + '/api/gmail/callback'
    );
}

// ─── Google Calendar helpers ──────────────────────────────────────────────────
async function createCalendarEvent(teacher, slot) {
    try {
        if (!teacher.calendar_access_token) return null;
        const auth = makeOAuth2Client();
        auth.setCredentials({
            access_token: teacher.calendar_access_token,
            refresh_token: teacher.calendar_refresh_token,
            expiry_date: teacher.calendar_token_expiry
        });
        const calendar = google.calendar({ version: 'v3', auth });
        const event = {
            summary: `Clase - ${slot.student_name || 'Alumno'}`,
            description: 'Clase programada en AcademiaPro',
            start: { dateTime: new Date(slot.start_datetime).toISOString(), timeZone: 'Europe/Madrid' },
            end: { dateTime: new Date(slot.end_datetime).toISOString(), timeZone: 'Europe/Madrid' },
            conferenceData: {
                createRequest: {
                    requestId: `academiapro-${Date.now()}`,
                    conferenceSolutionKey: { type: 'hangoutsMeet' }
                }
            },
            attendees: slot.student_email ? [{ email: slot.student_email }] : []
        };
        const response = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
            conferenceDataVersion: 1,
            sendUpdates: 'all'
        });
        const meetLink = response.data.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri;
        console.log('[Calendar] Event created:', response.data.id, 'Meet:', meetLink);
        return { google_event_id: response.data.id, meet_link: meetLink || null };
    } catch (err) {
        console.error('[Calendar] createCalendarEvent error:', err.message);
        Sentry.captureException(err);
        return null;
    }
}

async function deleteCalendarEvent(teacher, googleEventId) {
    try {
        if (!teacher.calendar_access_token || !googleEventId) return;
        const auth = makeOAuth2Client();
        auth.setCredentials({
            access_token: teacher.calendar_access_token,
            refresh_token: teacher.calendar_refresh_token
        });
        const calendar = google.calendar({ version: 'v3', auth });
        await calendar.events.delete({ calendarId: 'primary', eventId: googleEventId });
        console.log('[Calendar] Event deleted:', googleEventId);
    } catch (err) {
        console.error('[Calendar] deleteCalendarEvent error:', err.message);
        Sentry.captureException(err);
    }
}

const { checkAndProcessTranscripts } = require('./services/gmail')(io);
// ─────────────────────────────────────────────────────────────────────────────

// DAILY CRON JOBS
const initCrons = require('./cron');

const PORT = process.env.PORT || 3000;
const multer = require('multer');


const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000'];
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(helmet({ contentSecurityPolicy: false }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
const aiLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false });
app.use('/api/', globalLimiter);
app.use('/api/login', loginLimiter);
app.use('/api/register', registerLimiter);
app.use('/api/join', registerLimiter);
app.use('/api/ai-tutor', aiLimiter);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({ secret: process.env.SESSION_SECRET || 'academia-secret-change-in-prod', resave: false, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());
app.use(calendarRouter);
app.use(studentsRouter);
app.use(sessionsRouter);
app.use(paymentsRouter);
app.use(teachersRouter);
app.use(examsRouter);
app.use(makeChatRouter(io));
app.use(authRouter);
app.use(aiRouter);
app.use('/api', notificationsRouter);
app.use('/api', reportsRouter);
app.use('/api', settingsRouter);
app.use(makeTranscriptsRouter(io));

// Public static files
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'dummy',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'dummy',
    callbackURL: process.env.NODE_ENV === 'production'
        ? 'https://web-production-d02f4.up.railway.app/auth/google/callback'
        : 'http://localhost:3000/auth/google/callback',
    passReqToCallback: true
}, (req, accessToken, refreshToken, profile, cb) => cb(null, profile)));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// API Authentication Middlewares
const JWT_SECRET = process.env.JWT_SECRET;

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
const requireTeacherOrAdmin = (req, res, next) => {
    if (req.user && (req.user.role === 'teacher' || req.user.role === 'admin')) next();
    else res.status(403).send('Forbidden');
};

app.get('/landing', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/privacy.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));
app.get('/terms.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));

// Auth Routes
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public/login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public/register.html')));
app.get('/join', (req, res) => res.sendFile(path.join(__dirname, 'public/join.html')));
app.get('/auth-success', (req, res) => res.sendFile(path.join(__dirname, 'public', 'auth-success.html')));
app.get('/teacher', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher_dashboard.html')));
app.get('/teacher/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher_dashboard.html')));
app.get('/teacher/sessions', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher_sessions.html')));
app.get('/teacher/exams', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher_exams.html')));
app.get('/teacher/students', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher_dashboard.html')));
app.get('/teacher/calendar', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher_calendar.html')));
app.get('/teacher/chat', (req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));
app.get('/teacher/settings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher_settings.html')));
app.get('/teacher/transcripts', (req, res) => res.sendFile(path.join(__dirname, 'public', 'transcripts.html')));
app.get('/student', (req, res) => res.sendFile(path.join(__dirname, 'public', 'student_portal.html')));
app.get('/student-portal', (req, res) => res.sendFile(path.join(__dirname, 'public', 'student_portal.html')));



// Main Page Routes
app.get('/', (req, res) => {
    let token = req.cookies.token;
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    }
    if (!token) return res.sendFile(path.join(__dirname, 'public/landing.html'));

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendFile(path.join(__dirname, 'public/landing.html'));
        if (user.role === 'admin') res.sendFile(path.join(__dirname, 'public/index.html'));
        else res.redirect(user.role === 'teacher' ? '/teacher/dashboard' : '/student-portal');
    });
});
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

app.get('/teacher/student/:id', authenticateJWT, requireTeacherOrAdmin, (req, res) => {
    db.query('SELECT id FROM students WHERE id = $1 AND assigned_teacher_id = $2', [req.params.id, req.user.id], (err, result) => {
        const row = result?.rows[0];
        if (row) res.sendFile(path.join(__dirname, 'public/teacher_student_profile.html'));
        else res.redirect('/teacher/dashboard');
    });
});

// Admin Teacher Pages
app.get('/admin/teachers', authenticateJWT, (req, res) => res.sendFile(path.join(__dirname, 'public/admin_teachers.html')));
app.get('/admin/teacher/:id', authenticateJWT, (req, res) => res.sendFile(path.join(__dirname, 'public/admin_teacher_profile.html')));





// Add express static for other files (must be AFTER root and routes)
// Serve everything EXCEPT /uploads (which is protected below)
app.use(express.static(path.join(__dirname, 'public'), {
    index: false,
    // Block direct access to uploads — handled by the authenticated route below
    setHeaders: (res, filePath) => {
        if (filePath.includes(path.sep + 'uploads' + path.sep)) {
            res.status(403).end();
        }
    }
}));

// Authenticated file serving for uploads
app.get('/uploads/:folder/:filename', (req, res, next) => {
    // Return JSON 401 (not a redirect) so API clients handle it correctly
    const token = req.cookies?.token ||
        (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    next();
}, authenticateJWT, (req, res) => {
    const { folder, filename } = req.params;
    // Only allow known upload folders
    if (!['chat', 'reports'].includes(folder)) return res.status(404).end();

    // Prevent path traversal
    const safeName = path.basename(filename);
    const filePath = path.join(__dirname, 'public', 'uploads', folder, safeName);

    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });
    res.sendFile(filePath);
});


// ─── Risk detection (also used by generic CRUD) ───────────────────────────────
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
                    notifyAtRisk(studentId, 'No entrega deberes (3 sesiones seguidas)');
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
                        notifyAtRisk(studentId, 'Bajada de notas en los últimos exámenes');
                    }
                }
            });
        });
    });
};

async function notifyAtRisk(studentId, reason) {
    try {
        const r = await db.query(
            `SELECT s.name, s.academy_id, s.assigned_teacher_id,
                    u_admin.id AS admin_id
             FROM students s
             LEFT JOIN users u_admin ON u_admin.academy_id = s.academy_id AND u_admin.role = 'admin'
             WHERE s.id = $1 LIMIT 1`,
            [studentId]
        );
        const row = r.rows[0];
        if (!row) return;
        const title = `⚠️ Alumno en riesgo: ${row.name}`;
        const msg = reason;
        const link = null;
        if (row.admin_id) createNotification(row.admin_id, row.academy_id, 'at_risk', title, msg, link);
        if (row.assigned_teacher_id) createNotification(row.assigned_teacher_id, row.academy_id, 'at_risk', title, msg, link);
    } catch (e) { console.error('[notifyAtRisk]', e.message); }
}










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


// ─── Onboarding wizard ───────────────────────────────────────────────────────
app.get('/api/onboarding/status', authenticateJWT, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.json({ show: false });

        const userResult = await db.query(
            'SELECT onboarding_completed FROM users WHERE id = $1', [req.user.id]
        );
        const user = userResult.rows[0];
        if (user?.onboarding_completed) return res.json({ show: false });

        const [students, teachers, codes] = await Promise.all([
            db.query('SELECT COUNT(*) FROM students WHERE academy_id = $1', [req.user.academy_id]),
            db.query("SELECT COUNT(*) FROM users WHERE academy_id = $1 AND role = 'teacher'", [req.user.academy_id]),
            db.query('SELECT teacher_code, student_code FROM academies WHERE id = $1', [req.user.academy_id])
        ]);

        res.json({
            show: true,
            stats: {
                students: parseInt(students.rows[0].count),
                teachers: parseInt(teachers.rows[0].count),
                teacher_code: codes.rows[0]?.teacher_code,
                student_code: codes.rows[0]?.student_code
            }
        });
    } catch (err) {
        res.json({ show: false });
    }
});

app.post('/api/onboarding/complete', authenticateJWT, async (req, res) => {
    try {
        await db.query('UPDATE users SET onboarding_completed = TRUE WHERE id = $1', [req.user.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ─────────────────────────────────────────────────────────────────────────────




// Generic CRUD fallback — academy-scoped and column-whitelisted to prevent cross-tenant tampering and SQL injection
const CRUD_ALLOWED_COLUMNS = {
    students: new Set(['name', 'course', 'subject', 'status', 'join_date', 'parent_email', 'parent_phone', 'assigned_teacher_id', 'monthly_fee', 'payment_day', 'payment_method', 'payment_notes', 'payment_start_date']),
    sessions: new Set(['date', 'duration_minutes', 'homework_done', 'teacher_notes', 'slot_id', 'meet_link']),
    exams:    new Set(['date', 'subject', 'score', 'notes']),
    payments: new Set(['amount', 'due_date', 'paid_date', 'status'])
};

['students', 'sessions', 'exams', 'payments'].forEach(tableName => {
    app.put(`/api/${tableName}/:id`, authenticateJWT, (req, res) => {
        const allowed = CRUD_ALLOWED_COLUMNS[tableName];
        const allKeys = Object.keys(req.body);
        const badKeys = allKeys.filter(k => !allowed.has(k));
        if (badKeys.length) return res.status(400).json({ error: `Invalid fields: ${badKeys.join(', ')}` });
        const keys = allKeys.filter(k => allowed.has(k));
        if (!keys.length) return res.status(400).json({ error: 'No valid fields to update' });

        const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');
        const idParam = keys.length + 1;
        const academyParam = keys.length + 2;
        const academyFilter = tableName === 'students'
            ? `AND academy_id = $${academyParam}`
            : `AND student_id IN (SELECT id FROM students WHERE academy_id = $${academyParam})`;
        const values = [...keys.map(k => req.body[k]), req.params.id, req.user.academy_id];

        db.query(`UPDATE ${tableName} SET ${setClause} WHERE id = $${idParam} ${academyFilter}`, values, (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            if (result.rowCount === 0) return res.status(404).json({ error: 'Record not found or access denied' });
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
        const academyFilter = tableName === 'students'
            ? `AND academy_id = $2`
            : `AND student_id IN (SELECT id FROM students WHERE academy_id = $2)`;
        db.query(`DELETE FROM ${tableName} WHERE id = $1 ${academyFilter}`, [req.params.id, req.user.academy_id], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            if (result.rowCount === 0) return res.status(404).json({ error: 'Record not found or access denied' });
            res.json({ deleted: result.rowCount });
        });
    });
});



// Socket.io for Real-time chat
io.on('error', (err) => console.error('Socket error:', err));
io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);

    // socket.user is already set by io.use() middleware
    const user = socket.user;
    if (!user) {
        console.log('No user on socket, disconnecting');
        socket.disconnect();
        return;
    }

    console.log('Socket authenticated, userId:', user.id, 'role:', user.role);

    // Auto-join academy and user rooms
    socket.join(`academy_${user.academy_id}`);
    socket.join(`user_${user.id}`);

    socket.on('join_rooms', (roomIds) => {
        if (!Array.isArray(roomIds)) return;
        roomIds.forEach(roomId => socket.join(`room_${roomId}`));
        console.log('User', user.id, 'joined rooms:', roomIds);
    });

    socket.on('join_room', (roomId) => {
        socket.join(`room_${roomId}`);
    });

    socket.on('sendMessage', async ({ roomId, content, tempId }) => {
        console.log('sendMessage from', user.id, 'to room', roomId, ':', content);
        try {
            if (!roomId || !content?.trim()) return;

            // Verify membership
            const memberCheck = await db.query(
                'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
                [roomId, user.id]
            );
            if (!memberCheck.rows.length) {
                console.log('User', user.id, 'not member of room', roomId);
                socket.emit('error', { message: 'Not a member of this room' });
                return;
            }

            // Save to DB
            const result = await db.query(
                `INSERT INTO messages (room_id, sender_id, academy_id, content, created_at)
                 VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
                [roomId, user.id, user.academy_id, content.trim()]
            );
            const message = result.rows[0];
            console.log('Message saved to DB, id:', message.id);

            // Broadcast to room (echo tempId so sender can deduplicate)
            io.to(`room_${roomId}`).emit('new_message', {
                ...message,
                sender_name: user.name,
                sender_role: user.role,
                sender_id: user.id,
                tempId: tempId || null
            });

            // Notify other room members
            const membersRes = await db.query(
                'SELECT user_id FROM room_members WHERE room_id = $1 AND user_id != $2',
                [roomId, user.id]
            );
            const preview = content.trim().length > 60 ? content.trim().slice(0, 60) + '…' : content.trim();
            for (const m of membersRes.rows) {
                createNotification(m.user_id, user.academy_id, 'message',
                    `💬 Nuevo mensaje de ${user.name}`,
                    preview,
                    `/chat?room=${roomId}`
                );
            }
        } catch (err) {
            console.error('sendMessage error:', err.message);
            socket.emit('error', { message: 'Error sending message' });
        }
    });

    socket.on('typing', ({ roomId }) => {
        socket.to(`room_${roomId}`).emit('typing', {
            userId: user.id,
            userName: user.name
        });
    });

    socket.on('disconnect', () => {
        console.log('Socket disconnected:', user.id);
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
        // Look up names to build a meaningful room name
        const usersRes = await db.query(
            'SELECT id, name FROM users WHERE id = ANY($1::int[])',
            [[u1, u2]]
        );
        const usersMap = {};
        (usersRes.rows || []).forEach(u => { usersMap[u.id] = u.name; });
        const roomName = `${usersMap[u1] || u1} - ${usersMap[u2] || u2}`;

        const insertSql = isPostgres
            ? "INSERT INTO rooms (academy_id, type, name, created_at) VALUES ($1, 'direct', $2, NOW()) RETURNING id"
            : "INSERT INTO rooms (academy_id, type, name, created_at) VALUES ($1, 'direct', $2, datetime('now'))";
        const newR = await db.query(insertSql, [academyId, roomName]);
        const nrId = isPostgres && newR.rows ? newR.rows[0].id : newR.lastID;

        const insertMemberSql = isPostgres
            ? "INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
            : "INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES ($1, $2)";

        await db.query(insertMemberSql, [nrId, u1]);
        await db.query(insertMemberSql, [nrId, u2]);
    }
}


// ─── Sentry express error handler (must be after all routes) ─────────────────
Sentry.setupExpressErrorHandler(app);
// ─────────────────────────────────────────────────────────────────────────────

db.initDb().then(async () => {
    try {
        await db.query(`
            INSERT INTO students (name, email, course, subject, status, academy_id, user_id)
            SELECT u.name, u.email, 'Sin asignar', 'Sin asignar', 'active', u.academy_id, u.id
            FROM users u 
            WHERE u.role = 'student' 
            AND u.id NOT IN (SELECT user_id FROM students WHERE user_id IS NOT NULL)
        `);
    } catch(e) {
        console.log('Student table sync with email failed, trying without email column:', e.message);
        try {
            await db.query(`
                INSERT INTO students (name, course, subject, status, academy_id, user_id)
                SELECT u.name, 'Sin asignar', 'Sin asignar', 'active', u.academy_id, u.id
                FROM users u 
                WHERE u.role = 'student' 
                AND u.id NOT IN (SELECT user_id FROM students WHERE user_id IS NOT NULL)
            `);
        } catch(e2) {
            console.log('Student table auto-sync completely failed:', e2.message);
        }
    }

    server.listen(PORT, () => {
        console.log('Server running on port ' + PORT);

        console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
        console.log('NODE_ENV:', process.env.NODE_ENV);
        console.log('DB TYPE:', process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('your_postgres') ? 'PostgreSQL' : 'SQLite');

        // ensureAllChatRooms(); // Disabled to fix duplicates
        initCrons();

        // Auto-check Gmail transcripts every 15 minutes for all connected teachers
        setInterval(async () => {
            try {
                const result = await db.query(
                    "SELECT * FROM users WHERE role IN ('teacher', 'admin') AND gmail_access_token IS NOT NULL"
                );
                const teachers = result.rows || [];
                for (const teacher of teachers) {
                    await checkAndProcessTranscripts(teacher).catch(e =>
                        console.error('[Gmail] Auto-check error for teacher', teacher.id, ':', e.message)
                    );
                }
                if (teachers.length) console.log(`[Gmail] Auto-check: ${teachers.length} teacher(s) processed`);
            } catch (err) {
                console.error('[Gmail] Auto-check interval error:', err.message);
            }
        }, 15 * 60 * 1000);

        // Class reminder: notify students 15 minutes before class (check every minute)
        setInterval(async () => {
            try {
                const now = new Date();
                const in15 = new Date(now.getTime() + 15 * 60 * 1000);
                const slots = await db.query(`
                    SELECT s.id, s.meet_link, s.start_datetime,
                           st.user_id as student_user_id, st.academy_id
                    FROM available_slots s
                    JOIN students st ON s.student_id = st.id
                    WHERE s.is_booked = TRUE
                      AND s.meet_link IS NOT NULL
                      AND s.reminder_sent = FALSE
                      AND s.start_datetime > $1
                      AND s.start_datetime <= $2
                `, [now.toISOString(), in15.toISOString()]);
                for (const slot of (slots.rows || [])) {
                    await createNotification(
                        slot.student_user_id,
                        slot.academy_id,
                        'class_reminder',
                        '🎥 Tu clase empieza en 15 minutos',
                        'Haz clic para unirte a la videollamada',
                        slot.meet_link
                    );
                    await db.query('UPDATE available_slots SET reminder_sent = TRUE WHERE id = $1', [slot.id]);
                }
            } catch (err) {
                console.error('[Calendar] Class reminder error:', err.message);
            }
        }, 60 * 1000);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
});
