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
const calendarRouter      = require('./routes/calendar');
const studentsRouter      = require('./routes/students');
const sessionsRouter      = require('./routes/sessions');
const paymentsRouter      = require('./routes/payments');
const teachersRouter      = require('./routes/teachers');
const examsRouter         = require('./routes/exams');
const makeChatRouter      = require('./routes/chat');
const authRouter          = require('./routes/auth');
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

async function checkAndProcessTranscripts(teacher) {
    const oauth2Client = makeOAuth2Client();
    oauth2Client.setCredentials({
        access_token: teacher.gmail_access_token,
        refresh_token: teacher.gmail_refresh_token,
        expiry_date: teacher.gmail_token_expiry
    });

    // Persist refreshed tokens automatically
    oauth2Client.on('tokens', async (tokens) => {
        await db.query(
            'UPDATE users SET gmail_access_token=$1, gmail_refresh_token=$2, gmail_token_expiry=$3 WHERE id=$4',
            [tokens.access_token, tokens.refresh_token || teacher.gmail_refresh_token, tokens.expiry_date, teacher.id]
        ).catch(err => console.error('[OAuth] Gmail token persist failed:', err.message));
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const lastCheck = teacher.gmail_last_check
        ? Math.floor(new Date(teacher.gmail_last_check).getTime() / 1000)
        : Math.floor(Date.now() / 1000) - 86400; // last 24h if never checked

    const searchQuery = `(from:meet-recordings-noreply@google.com OR subject:"Transcripción de" OR subject:"Transcript of") after:${lastCheck}`;

    const messagesRes = await gmail.users.messages.list({ userId: 'me', q: searchQuery, maxResults: 10 });
    const messages = messagesRes.data.messages || [];
    console.log(`[Gmail] Found ${messages.length} transcript emails for teacher ${teacher.id}`);

    let processed = 0;

    for (const msg of messages) {
        try {
            const email = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
            function extractText(payload) {
                if (payload.mimeType === 'text/plain' && payload.body?.data) {
                    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
                }
                if (payload.parts) {
                    for (const part of payload.parts) {
                        const text = extractText(part);
                        if (text) return text;
                    }
                }
                return '';
            }
            const body = extractText(email.data.payload);
            if (!body || body.length < 100) continue;

            // Get teacher's students
            const studentsResult = teacher.role === 'admin'
                ? await db.query(
                    'SELECT s.id, s.name, s.user_id FROM students s WHERE s.academy_id = $1',
                    [teacher.academy_id]
                  )
                : await db.query(
                    'SELECT s.id, s.name, s.user_id FROM students s WHERE s.academy_id = $1 AND s.assigned_teacher_id = $2',
                    [teacher.academy_id, teacher.id]
                  );
            const students = studentsResult.rows || [];
            if (!students.length) continue;

            // Analyze with Groq
            const studentNames = students.map(s => s.name).join(', ');
            const analysis = await groqClient.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages: [{
                    role: 'user',
                    content: `Analiza esta transcripción de clase de Google Meet y genera un resumen estructurado.\n\nAlumnos posibles: ${studentNames}\n\nTranscripción:\n${body.substring(0, 8000)}\n\nResponde SOLO en JSON con este formato exacto:\n{\n  "student_name": "nombre del alumno que aparece o más probable",\n  "summary": "Resumen de lo tratado en clase en 2-3 frases",\n  "topics_covered": ["tema1", "tema2"],\n  "topics_pending": ["tema pendiente 1"],\n  "homework": ["tarea 1", "tarea 2"],\n  "key_points": ["punto clave 1", "punto clave 2"],\n  "teacher_notes": "Observaciones importantes del profesor"\n}`
                }],
                max_tokens: 1000,
                temperature: 0.3,
                response_format: { type: 'json_object' }
            });

            let analysisData;
            try {
                analysisData = JSON.parse(analysis.choices[0].message.content);
            } catch (e) {
                console.error('[Gmail] JSON parse error:', e.message);
                continue;
            }

            // Match student by name
            const student = students.find(s =>
                s.name.toLowerCase().includes((analysisData.student_name || '').toLowerCase()) ||
                (analysisData.student_name || '').toLowerCase().includes(s.name.toLowerCase())
            ) || students[0];

            if (!student) continue;

            // Resolve student user_id
            let studentUserId = student.user_id;
            if (!studentUserId) {
                const nameMatch = await db.query(
                    "SELECT id FROM users WHERE academy_id=$1 AND role='student' AND LOWER(name)=LOWER($2) LIMIT 1",
                    [teacher.academy_id, student.name]
                );
                studentUserId = (nameMatch.rows || [])[0]?.id;
                if (studentUserId) {
                    await db.query('UPDATE students SET user_id=$1 WHERE id=$2', [studentUserId, student.id]).catch(err => console.error('[Transcript] Student user_id link failed:', err.message));
                    student.user_id = studentUserId;
                }
            }
            if (!studentUserId) {
                console.warn(`[Gmail] No user_id for student ${student.name}, skipping`);
                continue;
            }

            // Find or create direct room
            const roomResult = await db.query(
                `SELECT r.id FROM rooms r
                 JOIN room_members rm1 ON r.id = rm1.room_id AND rm1.user_id = $1
                 JOIN room_members rm2 ON r.id = rm2.room_id AND rm2.user_id = $2
                 WHERE r.type = 'direct' AND r.academy_id = $3
                 LIMIT 1`,
                [teacher.id, studentUserId, teacher.academy_id]
            );
            let roomId = (roomResult.rows || [])[0]?.id;

            if (!roomId) {
                const newRoom = await db.query(
                    `INSERT INTO rooms (academy_id, type, name, created_at) VALUES ($1, 'direct', $2, NOW()) RETURNING id`,
                    [teacher.academy_id, `${teacher.name} - ${student.name}`]
                );
                roomId = newRoom.rows[0].id;
                const memberSql = isPostgres
                    ? 'INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING'
                    : 'INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES ($1, $2)';
                await db.query(memberSql, [roomId, teacher.id]);
                await db.query(memberSql, [roomId, studentUserId]);
            }

            // Build and save chat message
            const d = analysisData;
            const chatMessage =
                `📋 **Resumen de clase - ${new Date().toLocaleDateString('es-ES')}**\n\n` +
                `📚 **Temas tratados:**\n${(d.topics_covered || []).map(t => `• ${t}`).join('\n') || '• Ver transcripción'}\n\n` +
                `📝 **Deberes:**\n${(d.homework || []).length ? d.homework.map(h => `• ${h}`).join('\n') : '• Sin deberes asignados'}\n\n` +
                `🎯 **Puntos clave:**\n${(d.key_points || []).map(k => `• ${k}`).join('\n') || ''}\n\n` +
                `⏭️ **Próximos temas:**\n${(d.topics_pending || []).map(t => `• ${t}`).join('\n') || '• Por determinar'}\n\n` +
                `💬 **Nota del profesor:**\n${d.teacher_notes || d.summary || ''}`;

            await db.query(
                `INSERT INTO messages (room_id, sender_id, academy_id, content, created_at) VALUES ($1, $2, $3, $4, NOW())`,
                [roomId, teacher.id, teacher.academy_id, chatMessage]
            );

            // Save transcript record
            await db.query(
                'INSERT INTO transcripts (academy_id, teacher_id, student_id, raw_text, processed_json) VALUES ($1, $2, $3, $4, $5)',
                [teacher.academy_id, teacher.id, student.id, body.substring(0, 5000), JSON.stringify(analysisData)]
            );

            // Notify student if they have an account
            if (student.user_id) {
                createNotification(student.user_id, teacher.academy_id, 'transcript',
                    '📝 Resumen de sesión disponible',
                    `Tu profesor ha procesado la transcripción de la última sesión.`,
                    '/student-portal'
                );
            }

            // Emit via Socket.IO
            io.to(`room_${roomId}`).emit('new_message', {
                room_id: roomId,
                sender_id: teacher.id,
                sender_name: teacher.name,
                sender_role: 'teacher',
                content: chatMessage,
                created_at: new Date().toISOString()
            });

            // Mark email as read
            await gmail.users.messages.modify({
                userId: 'me',
                id: msg.id,
                requestBody: { removeLabelIds: ['UNREAD'] }
            });

            processed++;
            console.log(`[Gmail] Processed transcript for student ${student.name}`);
        } catch (err) {
            console.error('[Gmail] Error processing email:', err.message);
            Sentry.captureException(err);
        }
    }

    await db.query('UPDATE users SET gmail_last_check=NOW() WHERE id=$1', [teacher.id]).catch(err => console.error('[Gmail] Last check update failed:', err.message));
    return processed;
}
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
            Sentry.captureException(e);
            res.status(500).json({ error: 'Error leyendo PDF: ' + e.message });
        }
    });
});

app.post('/api/ai-tutor/chat', authenticateJWT, async (req, res) => {
    const { messages, conversationId: clientConversationId } = req.body;
    console.log('[ai-tutor/chat] user:', req.user?.id, 'role:', req.user?.role, 'academy_id:', req.user?.academy_id);
    console.log('[ai-tutor/chat] GROQ_API_KEY set:', !!process.env.GROQ_API_KEY);
    console.log('[ai-tutor/chat] clientConversationId:', clientConversationId);
    let systemPrompt = "Eres un asistente educativo inteligente de AcademiaPro. Ayudas a estudiantes con cualquier materia y duda académica. Explicas conceptos de forma clara y adaptada al nivel del alumno. Eres paciente, motivador y pedagógico. Responde SIEMPRE en español.";

    try {
        if (req.user.role === 'teacher') {
            systemPrompt = "Eres un asistente pedagógico inteligente de AcademiaPro. Ayudas a profesores a preparar clases, crear ejercicios, explicar conceptos difíciles, gestionar alumnos y mejorar su metodología docente. Responde SIEMPRE en español.";
        }

        // Extract user message before anything else
        const userMessage = messages[messages.length - 1]?.content || '';
        const userMessageStr = typeof userMessage === 'string' ? userMessage : JSON.stringify(userMessage);

        // Use conversation from client if provided, otherwise create a new one
        let conversationId = clientConversationId ? parseInt(clientConversationId) : null;

        if (!conversationId) {
          const newConv = await db.query(
            'INSERT INTO ai_conversations (user_id, academy_id, title, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id',
            [req.user.id, req.user.academy_id, userMessageStr.substring(0, 50)]
          );
          conversationId = newConv.rows[0].id;
          console.log('[ai-tutor/chat] created new conversation:', conversationId);
        } else {
          // Update updated_at on existing conversation
          await db.query('UPDATE ai_conversations SET updated_at = NOW() WHERE id = $1', [conversationId]).catch(err => console.error('[AI Tutor] Conversation timestamp update failed:', err.message));
          console.log('[ai-tutor/chat] using existing conversation:', conversationId);
        }

        // Save user message BEFORE calling AI
        console.log('[ai-tutor/chat] saving user message to conversation', conversationId);
        await db.query(
          'INSERT INTO ai_messages (conversation_id, role, content, created_at) VALUES ($1, $2, $3, NOW())',
          [conversationId, 'user', userMessageStr]
        );

        // Check if any message contains a doc/image object (like PDF base64).
        const hasComplexContent = messages.some(m => Array.isArray(m.content));
        const modelToUse = hasComplexContent ? "llama-3.2-11b-vision-preview" : "llama-3.3-70b-versatile";

        const apiResponse = await groqClient.chat.completions.create({
            model: modelToUse,
            messages: [{ role: 'system', content: systemPrompt }, ...messages],
            temperature: 0.7,
            max_tokens: 1024,
        });

        const aiResponse = apiResponse.choices[0].message.content;

        // Save AI response
        await db.query(
          'INSERT INTO ai_messages (conversation_id, role, content, created_at) VALUES ($1, $2, $3, NOW())',
          [conversationId, 'assistant', aiResponse]
        );
        console.log('[ai-tutor/chat] messages saved OK, conversation', conversationId);

        res.json({ response: aiResponse, conversationId });
    } catch (e) {
        console.error('[ai-tutor/chat] ERROR:', e.message, e.stack);
        Sentry.captureException(e);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.get('/api/ai-tutor/history', authenticateJWT, async (req, res) => {
  try {
    const convResult = await db.query(
      'SELECT id FROM ai_conversations WHERE user_id = $1 AND academy_id = $2 ORDER BY created_at DESC LIMIT 1',
      [req.user.id, req.user.academy_id]
    );
    const conv = convResult.rows?.[0];
    if (!conv) return res.json({ messages: [], conversationId: null });

    const messagesResult = await db.query(
      'SELECT id, role, content, created_at FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conv.id]
    );
    res.json({ messages: messagesResult.rows || [], conversationId: conv.id });
  } catch(err) {
    console.error('History error:', err.message);
    Sentry.captureException(err);
    res.json({ messages: [], conversationId: null });
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

        doc.end();
    } catch (err) {
        console.error('PDF gen error:', err);
        Sentry.captureException(err);
        res.status(500).json({ error: 'Failed to generate PDF' });
    }
});



// ─── Gmail OAuth endpoints ────────────────────────────────────────────────────
app.get('/api/gmail/connect', authenticateJWT, requireTeacherOrAdmin, (req, res) => {
    const oauth2Client = makeOAuth2Client();
    const nonce = crypto.randomBytes(8).toString('hex');
    const stateData = `${req.user.id}:${nonce}`;
    const sig = crypto.createHmac('sha256', JWT_SECRET).update(stateData).digest('hex').substring(0, 16);
    const signedState = Buffer.from(JSON.stringify({ d: stateData, s: sig })).toString('base64');
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/calendar.events'
        ],
        state: signedState
    });
    res.json({ authUrl });
});


app.get('/api/gmail/callback', async (req, res) => {
    try {
        const { code, state: rawState } = req.query;
        let userId;
        try {
            const parsed = JSON.parse(Buffer.from(rawState, 'base64').toString());
            const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(parsed.d).digest('hex').substring(0, 16);
            if (parsed.s !== expectedSig) throw new Error('Invalid state signature');
            userId = parsed.d.split(':')[0];
            if (!userId || isNaN(Number(userId))) throw new Error('Invalid userId in state');
        } catch (e) {
            console.error('[Gmail] Invalid state:', e.message);
            return res.redirect('/teacher/settings?gmail=error');
        }
        const oauth2Client = makeOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);
        await db.query(
            'UPDATE users SET gmail_access_token=$1, gmail_refresh_token=$2, gmail_token_expiry=$3 WHERE id=$4',
            [tokens.access_token, tokens.refresh_token, tokens.expiry_date, userId]
        );
        console.log('[Gmail] Connected for user:', userId);
        res.redirect('/teacher/settings?gmail=connected');
    } catch (err) {
        console.error('[Gmail] Callback error:', err.message);
        Sentry.captureException(err);
        res.redirect('/teacher/settings?gmail=error');
    }
});

app.get('/api/gmail/status', authenticateJWT, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT gmail_access_token, transcript_email FROM users WHERE id=$1',
            [req.user.id]
        );
        const user = result.rows[0];
        res.json({
            connected: !!user?.gmail_access_token,
            transcript_email: user?.transcript_email || null
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/gmail/transcript-email', authenticateJWT, requireTeacherOrAdmin, async (req, res) => {
    try {
        const { transcript_email } = req.body;
        await db.query('UPDATE users SET transcript_email=$1 WHERE id=$2', [transcript_email, req.user.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/gmail/check-transcripts', authenticateJWT, requireTeacherOrAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
        const teacher = result.rows[0];
        if (!teacher.gmail_access_token) {
            return res.status(400).json({ error: 'Gmail no conectado. Conecta tu Gmail primero.' });
        }
        const processed = await checkAndProcessTranscripts(teacher);
        res.json({ success: true, processed });
    } catch (err) {
        console.error('[Gmail] check-transcripts error:', err.message);
        Sentry.captureException(err);
        res.status(500).json({ error: err.message });
    }
});
// ─────────────────────────────────────────────────────────────────────────────

// TRANSCRIPTS API
app.get('/admin/transcripts', authenticateJWT, requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public/transcripts.html')));
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
                try {
                    const pdfParse = require('pdf-parse');
                    const data = await pdfParse(req.file.buffer);
                    transcript_text = data.text;
                } catch (e) {
                    console.error('Error pdf-parse:', e);
                    return res.status(400).json({ error: 'Error procesando el PDF. Asegúrate de que el archivo es válido.' });
                }
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

        // Truncate to ~12 000 chars to stay well within token limits
        const transcriptForAI = transcript_text.substring(0, 12000);

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
${transcriptForAI}`;

        let apiResponse;
        try {
            apiResponse = await groqClient.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: 'system', content: 'Eres un asistente educativo que analiza transcripciones de clases particulares. Tu tarea es extraer la información más útil para el alumno. Responde EXCLUSIVAMENTE con el JSON solicitado.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.3,
                max_tokens: 1024,
                response_format: { type: "json_object" }
            });
        } catch (e) {
            console.error('Groq API error:', e.message, e.status, e.error);
            Sentry.captureException(e);
            return res.status(500).json({ error: 'Error al contactar la IA: ' + e.message });
        }

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

        db.query(insertSql, [req.user.academy_id, ['teacher', 'admin'].includes(req.user.role) ? req.user.id : null, student_id, transcript_text.substring(0, 5000), JSON.stringify(jsonContent)]);

        res.json(jsonContent);
    } catch (err) {
        console.error('Transcript error:', err);
        Sentry.captureException(err);
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
               VALUES ($1, $2, $3, $4, FALSE, NOW())`
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
        Sentry.captureException(err);
        res.status(500).json({ error: 'Error al enviar el mensaje' });
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

// ─── Notifications ────────────────────────────────────────────────────────────
app.get('/api/notifications', authenticateJWT, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT * FROM notifications WHERE user_id = $1 AND academy_id = $2
             ORDER BY created_at DESC LIMIT 50`,
            [req.user.id, req.user.academy_id]
        );
        res.json(result.rows || []);
    } catch (err) {
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.post('/api/notifications/mark-read/:id', authenticateJWT, async (req, res) => {
    try {
        await db.query(
            `UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.post('/api/notifications/mark-all-read', authenticateJWT, async (req, res) => {
    try {
        await db.query(
            `UPDATE notifications SET read = TRUE WHERE user_id = $1`,
            [req.user.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});
// ──────────────────────────────────────────────────────────────────────────────

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








app.get('/api/reports/student/:id', authenticateJWT, async (req, res) => {
    try {
        // Verify student belongs to the caller's academy
        const ownershipQ = req.user.role === 'student'
            ? await db.query('SELECT id FROM students WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id])
            : await db.query('SELECT id FROM students WHERE id=$1 AND academy_id=$2', [req.params.id, req.user.academy_id]);
        if (!ownershipQ.rows.length) return res.status(403).json({ error: 'Acceso denegado' });

        const result = await db.query('SELECT * FROM reports WHERE student_id=$1 ORDER BY year DESC, month DESC', [req.params.id]);
        const monthsNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        res.json(result.rows.map(r => ({ ...r, monthName: monthsNames[r.month - 1], url: r.file_url })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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


app.get('/api/academy/info', authenticateJWT, (req, res) => {
    db.query('SELECT name FROM academies WHERE id = $1', [req.user.academy_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result?.rows[0] || {});
    });
});

app.get('/api/academy/codes', authenticateJWT, requireAdmin, (req, res) => {
    db.query('SELECT teacher_code, student_code FROM academies WHERE id = $1', [req.user.academy_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result?.rows[0]);
    });
});

app.post('/api/academy/regenerate', authenticateJWT, requireAdmin, (req, res) => {
    return res.status(403).json({ error: 'Los códigos de academia son permanentes y no se pueden regenerar.' });
});

// --- AI conversation history ---
app.get('/api/ai/conversations', authenticateJWT, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM ai_conversations WHERE user_id = $1 AND academy_id = $2 ORDER BY COALESCE(is_pinned, FALSE) DESC, updated_at DESC', [req.user.id, req.user.academy_id]);
        res.json(result.rows || []);
    } catch (err) {
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Create new conversation
app.post('/api/ai/conversations', authenticateJWT, (req, res) => {
    const { title } = req.body;
    const sql = isPostgres
        ? 'INSERT INTO ai_conversations (user_id, title) VALUES ($1, $2) RETURNING id'
        : 'INSERT INTO ai_conversations (user_id, title) VALUES ($1, $2)';
    db.query(sql, [req.user.id, title || 'Nueva conversación'], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        const id = isPostgres ? result.rows[0].id : result.lastID;
        res.json({ id });
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
app.get('/api/ai/conversations/:id/messages', authenticateJWT, async (req, res) => {
    try {
        const ownerCheck = await db.query('SELECT id FROM ai_conversations WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        if (!ownerCheck.rows.length) return res.status(403).json({ error: 'Acceso denegado' });
        const result = await db.query('SELECT * FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at ASC', [req.params.id]);
        res.json(result.rows || []);
    } catch (err) {
        res.status(500).json({ error: 'Error interno del servidor' });
    }
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

// Settings API — all keys stored as "{academy_id}_{key}" for multi-tenancy isolation
app.get('/api/settings', authenticateJWT, requireAdmin, async (req, res) => {
    try {
        const prefix = `${req.user.academy_id}_`;
        const result = await db.query(
            "SELECT key, value FROM settings WHERE key LIKE $1",
            [prefix + '%']
        );
        const settings = {};
        (result.rows || []).forEach(r => {
            settings[r.key.slice(prefix.length)] = r.value;
        });
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.post('/api/settings', authenticateJWT, requireAdmin, async (req, res) => {
    const settings = req.body;
    const academyId = req.user.academy_id;
    try {
        for (const [key, val] of Object.entries(settings)) {
            const prefixedKey = `${academyId}_${key}`;
            const sql = isPostgres
                ? "INSERT INTO settings (key, value, academy_id) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
                : "INSERT OR REPLACE INTO settings (key, value, academy_id) VALUES ($1, $2, $3)";
            await db.query(sql, [prefixedKey, String(val), academyId]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// AI Report Generation
app.post('/api/generate-report', authenticateJWT, async (req, res) => {
    try {
        const { student_id, studentId, month, year, observations, send_email, sendEmail } = req.body;
        const sid = student_id || studentId;
        const sendMail = send_email !== undefined ? send_email : sendEmail;
        const monthNum = parseInt(month) || new Date().getMonth() + 1;
        const yearNum = parseInt(year) || new Date().getFullYear();
        const monthsNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const monthText = monthsNames[monthNum - 1];
        const monthStart = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
        const monthEnd = new Date(yearNum, monthNum, 0).toISOString().split('T')[0];

        // Access control: teachers can only see their own students
        const studentQ = req.user.role === 'teacher'
            ? await db.query('SELECT * FROM students WHERE id=$1 AND academy_id=$2 AND assigned_teacher_id=$3', [sid, req.user.academy_id, req.user.id])
            : await db.query('SELECT * FROM students WHERE id=$1 AND academy_id=$2', [sid, req.user.academy_id]);
        const student = studentQ.rows[0];
        if (!student) return res.status(404).json({ error: 'Alumno no encontrado o sin acceso' });

        // Fetch data in parallel
        const [sessionsR, examsR, simsR] = await Promise.all([
            db.query('SELECT * FROM sessions WHERE student_id=$1 AND date>=$2 AND date<=$3 ORDER BY date', [sid, monthStart, monthEnd]),
            db.query('SELECT * FROM exams WHERE student_id=$1 AND date>=$2 AND date<=$3 ORDER BY date', [sid, monthStart, monthEnd]),
            db.query("SELECT * FROM simulator_results WHERE student_id=$1 AND created_at::text LIKE $2", [sid, `${yearNum}-${String(monthNum).padStart(2, '0')}%`]).catch(() => ({ rows: [] }))
        ]);
        const sessions = sessionsR.rows || [];
        const exams = examsR.rows || [];
        const sims = simsR.rows || [];

        const homeworkRate = sessions.length ? Math.round(sessions.filter(s => s.homework_done).length / sessions.length * 100) : 0;
        const avgScore = exams.length ? (exams.reduce((s, e) => s + (e.score || 0), 0) / exams.length).toFixed(1) : null;
        const examDetails = exams.map(e => `${e.subject}: ${e.score ?? 'Pendiente'}`).join(', ');
        const simDetails = sims.map(s => `${s.topic} (${s.percentage}%)${s.teacher_grade ? ' - Nota: ' + s.teacher_grade : ''}`).join(', ');

        // Generate AI text
        const aiResponse = await groqClient.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: 'Eres el tutor de una academia de repaso española. Genera un informe mensual profesional y cercano para la familia. Tono cálido pero profesional. Estructura: saludo personalizado, resumen positivo del mes, análisis de exámenes, áreas de mejora, próximos objetivos, cierre motivador. Máximo 250 palabras. Siempre en español.' },
                { role: 'user', content: `Estudiante: ${student.name}, Curso: ${student.course || '-'}, Asignatura: ${student.subject || '-'}. Sesiones este mes: ${sessions.length}. Tareas completadas: ${homeworkRate}%. Notas exámenes: ${examDetails || 'Ninguno'}. Simulacros: ${simDetails || 'Ninguno'}. Observaciones: ${observations || 'Sin observaciones adicionales'}.` }
            ],
            max_tokens: 500
        });
        const reportText = aiResponse.choices[0].message.content;

        // Generate PDF
        const reportsDir = path.join(__dirname, 'public/uploads/reports');
        if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
        const fileName = `informe_${student.name.replace(/ /g, '_')}_${monthNum}_${yearNum}_${Date.now()}.pdf`;
        const filePath = path.join(reportsDir, fileName);
        const fileUrl = `/uploads/reports/${fileName}`;

        await new Promise((resolve, reject) => {
            const doc = new PDFDocument({ margin: 50 });
            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);

            // Header
            doc.rect(0, 0, doc.page.width, 100).fill('#6366f1');
            doc.fillColor('white').fontSize(24).font('Helvetica-Bold').text('AcademiaPro', 50, 30);
            doc.fontSize(14).font('Helvetica').text(`Informe mensual — ${monthText} ${yearNum}`, 50, 62);

            // Student info
            doc.fillColor('#1e293b').fontSize(18).font('Helvetica-Bold').text(student.name, 50, 120);
            doc.fillColor('#64748b').fontSize(12).font('Helvetica').text(`${student.course || ''} · ${student.subject || ''}`, 50, 145);

            // Divider
            doc.moveTo(50, 170).lineTo(doc.page.width - 50, 170).strokeColor('#e2e8f0').lineWidth(1).stroke();

            // Stats
            doc.fillColor('#1e293b').fontSize(14).font('Helvetica-Bold').text('Resumen del mes', 50, 185);
            doc.fillColor('#374151').fontSize(12).font('Helvetica')
                .text(`• Sesiones realizadas: ${sessions.length}`, 50, 210)
                .text(`• Deberes entregados: ${homeworkRate}%`, 50, 230)
                .text(`• Nota media: ${avgScore || 'Sin exámenes'}`, 50, 250);

            // Divider
            doc.moveTo(50, 275).lineTo(doc.page.width - 50, 275).strokeColor('#e2e8f0').lineWidth(1).stroke();

            // AI text
            doc.fillColor('#1e293b').fontSize(14).font('Helvetica-Bold').text('Informe del tutor', 50, 290);
            doc.fillColor('#374151').fontSize(11).font('Helvetica').text(reportText, 50, 315, { width: doc.page.width - 100, lineGap: 4 });

            // Exams on next page if present
            if (exams.length > 0) {
                doc.addPage();
                doc.fillColor('#1e293b').fontSize(14).font('Helvetica-Bold').text('Exámenes del mes', 50, 50);
                let y = 80;
                exams.forEach(exam => {
                    doc.fillColor('#374151').fontSize(12).font('Helvetica')
                        .text(`• ${exam.subject}: ${exam.score ?? 'Pendiente'} — ${exam.date}`, 50, y);
                    y += 22;
                });
            }

            // Simulacros
            if (sims.length > 0) {
                if (exams.length === 0) doc.addPage();
                doc.fillColor('#1e293b').fontSize(14).font('Helvetica-Bold').moveDown(2).text('Simulacros del mes');
                sims.forEach(s => {
                    let t = `• ${s.topic}: ${s.percentage}%`;
                    if (s.teacher_grade) t += ` (Nota: ${s.teacher_grade}/10)`;
                    doc.fillColor('#374151').fontSize(12).font('Helvetica').text(t);
                });
            }

            // Footer
            doc.fillColor('#94a3b8').fontSize(10)
                .text(`Generado por AcademiaPro · ${new Date().toLocaleDateString('es-ES')}`, 50, doc.page.height - 40, { align: 'center' });

            doc.end();
            stream.on('finish', resolve);
            stream.on('error', reject);
        });

        // Save record
        await db.query(
            'INSERT INTO reports (student_id, academy_id, month, year, file_url, created_at) VALUES ($1,$2,$3,$4,$5,NOW())',
            [sid, req.user.academy_id, monthNum, yearNum, fileUrl]
        ).catch(err => console.error('[Report] DB record insert failed:', err.message));

        // Send email
        let emailSent = false;
        if (sendMail && student.parent_email) {
            try {
                const resend = new Resend(process.env.RESEND_API_KEY);
                const pdfBuffer = fs.readFileSync(filePath);
                await resend.emails.send({
                    from: 'AcademiaPro <onboarding@resend.dev>',
                    to: student.parent_email,
                    subject: `Informe mensual de ${student.name} — ${monthText} ${yearNum}`,
                    html: `<div style="font-family:Inter,sans-serif;max-width:500px;margin:0 auto;"><div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;border-radius:12px 12px 0 0;text-align:center;"><h1 style="color:white;margin:0;font-size:22px;">🎓 AcademiaPro</h1></div><div style="background:white;padding:32px;border:1px solid #e2e8f0;border-radius:0 0 12px 12px;"><p style="color:#1e293b">Estimada familia,</p><p style="color:#64748b">Adjunto encontrarás el informe mensual de <strong>${student.name}</strong> correspondiente a <strong>${monthText} ${yearNum}</strong>.</p><p style="color:#94a3b8;font-size:13px;margin-top:24px;">AcademiaPro · La plataforma inteligente para academias</p></div></div>`,
                    attachments: [{ filename: fileName, content: pdfBuffer.toString('base64') }]
                });
                emailSent = true;
                await db.query('INSERT INTO sent_reports (academy_id, student_id, month, year) VALUES ($1,$2,$3,$4)', [req.user.academy_id, sid, monthNum, yearNum]).catch(err => console.error('[Report] sent_reports insert failed:', err.message));
            } catch (emailErr) {
                console.error('[Report] Email error:', emailErr.message);
            }
        }

        // Notify student if they have an account
        if (student.user_id) {
            createNotification(student.user_id, req.user.academy_id, 'report',
                '📊 Nuevo informe disponible',
                `Tu informe de ${monthText} ${yearNum} ya está listo.`,
                fileUrl
            );
        }

        res.json({
            success: true,
            file_url: fileUrl,
            email_sent: emailSent,
            message: emailSent ? `Informe generado y enviado a ${student.parent_email}` : 'Informe generado correctamente'
        });

    } catch (err) {
        console.error('[Report] Error:', err.message);
        res.status(500).json({ error: 'Error al generar el informe' });
    }
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

app.post('/api/help-assistant/chat', authenticateJWT, async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;
    const role = req.user.role;

    const systemPrompts = {
      admin: `Eres el asistente de ayuda de AcademiaPro. Ayudas al administrador a usar la plataforma.
Puedes explicar cómo: gestionar estudiantes, añadir y gestionar profesores, ver y crear sesiones,
registrar pagos, generar informes PDF con IA, usar el chat, ver transcripciones de Google Meet,
configurar la academia, conectar Google Calendar y Gmail, usar el tutor IA, gestionar el calendario,
ver exámenes y rankings. Responde siempre en español, de forma clara y concisa.`,
      teacher: `Eres el asistente de ayuda de AcademiaPro. Ayudas al profesor a usar la plataforma.
Puedes explicar cómo: ver y gestionar sus alumnos asignados, registrar sesiones individuales y grupales,
registrar exámenes, usar el calendario y crear slots con Google Meet, procesar transcripciones de
Google Meet automáticamente, usar el chat con alumnos y el grupo de profesores, generar informes PDF,
usar el asistente IA, ver su configuración y conectar Gmail y Google Calendar.
Responde siempre en español, de forma clara y concisa.`,
      student: `Eres el asistente de ayuda de AcademiaPro. Ayudas al alumno a usar la plataforma.
Puedes explicar cómo: ver su panel principal con próximas sesiones y notas, usar el calendario
para ver sus clases y unirse a videollamadas de Google Meet, ver sus notas y exámenes,
ver sus pagos pendientes, hacer simulacros de examen con IA, usar el Tutor IA para resolver dudas,
chatear con su profesor, ver sus informes mensuales.
Responde siempre en español, de forma clara y concisa.`
    };

    const systemPrompt = systemPrompts[role] || systemPrompts.student;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.slice(-10),
      { role: 'user', content: message }
    ];

    const completion = await groqClient.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: 500,
      temperature: 0.7
    });

    const response = completion.choices[0]?.message?.content || 'No pude generar una respuesta.';
    res.json({ response });
  } catch (err) {
    console.error('Help assistant error:', err);
    res.status(500).json({ error: 'Error del asistente', response: 'Lo siento, ocurrió un error. Inténtalo de nuevo.' });
  }
});

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
