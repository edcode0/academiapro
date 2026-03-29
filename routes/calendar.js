'use strict';

const express   = require('express');
const router    = express.Router();
const crypto    = require('crypto');
const db        = require('../db');
const { google } = require('googleapis');
const { makeOAuth2Client, createCalendarEvent, deleteCalendarEvent } = require('../services/calendar');
const { authenticateJWT, JWT_SECRET } = require('../middleware/auth');
const { requireStudent, requireTeacherOrAdmin } = require('../middleware/roles');

const isPostgres = db.isPostgres;

// GET available slots depending on role
router.get('/api/calendar/slots', authenticateJWT, (req, res) => {
    let sql = `
        SELECT a.*, u.name as teacher_name, s.name as student_name, s.user_id as student_user_id
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
        // Show slots from assigned teacher OR directly assigned to this student (e.g. admin-created)
        db.query('SELECT id, assigned_teacher_id FROM students WHERE user_id = $1', [req.user.id], (err, r) => {
            if (err || !r.rows[0]) return res.json([]);
            const { id: studentRecordId, assigned_teacher_id } = r.rows[0];
            if (assigned_teacher_id) {
                sql += ` AND (a.teacher_id = $2 OR a.student_id = $3)`;
                params.push(assigned_teacher_id, studentRecordId);
            } else {
                sql += ` AND a.student_id = $2`;
                params.push(studentRecordId);
            }
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
router.post('/api/calendar/slots', authenticateJWT, requireTeacherOrAdmin, async (req, res) => {
    try {
        const { start_datetime, end_datetime, student_id, notes, meet_link: providedMeetLink } = req.body;
        const isBooked = !!student_id;
        const insertSql = isPostgres
            ? 'INSERT INTO available_slots (teacher_id, academy_id, start_datetime, end_datetime, is_booked, student_id, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id'
            : 'INSERT INTO available_slots (teacher_id, academy_id, start_datetime, end_datetime, is_booked, student_id, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)';
        const result = await db.query(insertSql, [req.user.id, req.user.academy_id, start_datetime, end_datetime, isBooked, student_id || null, notes || null]);
        const slotId = isPostgres ? result.rows[0].id : result.lastID;

        if (providedMeetLink) {
            // Meet link was already created on-demand — just save it
            await db.query('UPDATE available_slots SET meet_link = $1 WHERE id = $2', [providedMeetLink, slotId]);
        } else {
            // Auto-create Google Calendar event if teacher has OAuth connected
            try {
                const teacherRes = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
                const teacher = teacherRes.rows[0];
                if (teacher?.calendar_access_token) {
                    const calResult = await createCalendarEvent(teacher, { start_datetime, end_datetime, student_name: null, student_email: null });
                    if (calResult) {
                        await db.query(
                            'UPDATE available_slots SET google_event_id = $1, meet_link = $2 WHERE id = $3',
                            [calResult.google_event_id, calResult.meet_link, slotId]
                        );
                    }
                }
            } catch (calErr) {
                console.error('[Calendar] Slot create calendar error:', calErr.message);
            }
        }

        res.json({ success: true, is_booked: isBooked });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create a Google Meet link on demand for a session or slot
router.post('/api/calendar/meet', authenticateJWT, requireTeacherOrAdmin, async (req, res) => {
    try {
        const { student_id, date, start_time, end_time, slot_id, session_id } = req.body;
        if (!date || !start_time || !end_time) {
            return res.status(400).json({ error: 'Se requieren fecha, hora inicio y hora fin' });
        }

        const teacherRes = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        const teacher = teacherRes.rows[0];
        if (!teacher?.calendar_access_token) {
            return res.status(400).json({ error: 'Google Calendar no conectado. Ve a Configuración > Integraciones para conectarlo.' });
        }

        let studentName = 'Alumno';
        if (student_id) {
            const sr = await db.query('SELECT name FROM students WHERE id = $1 AND academy_id = $2', [student_id, req.user.academy_id]);
            if (sr.rows[0]) studentName = sr.rows[0].name;
        }

        const startDatetime = `${date}T${start_time}:00`;
        const endDatetime   = `${date}T${end_time}:00`;

        const calResult = await createCalendarEvent(teacher, {
            start_datetime: startDatetime,
            end_datetime:   endDatetime,
            student_name:   studentName
        });

        if (!calResult?.meet_link) {
            return res.status(500).json({ error: 'No se pudo generar el enlace de Meet. Verifica que Google Calendar esté conectado.' });
        }

        // Persist to slot if provided
        if (slot_id) {
            await db.query(
                'UPDATE available_slots SET google_event_id = $1, meet_link = $2 WHERE id = $3 AND academy_id = $4',
                [calResult.google_event_id, calResult.meet_link, slot_id, req.user.academy_id]
            );
        }

        // Persist to session if provided
        if (session_id) {
            await db.query(
                `UPDATE sessions SET meet_link = $1 WHERE id = $2
                 AND student_id IN (SELECT id FROM students WHERE academy_id = $3)`,
                [calResult.meet_link, session_id, req.user.academy_id]
            );
        }

        res.json({ meet_link: calResult.meet_link, event_id: calResult.google_event_id });
    } catch (err) {
        console.error('[Calendar] Meet create error:', err.message);
        res.status(500).json({ error: 'Error al crear el enlace de Meet' });
    }
});

// Teacher or Admin deletes slot
router.delete('/api/calendar/slots/:id', authenticateJWT, async (req, res) => {
    if (req.user.role === 'student') return res.status(403).json({ error: 'Access denied' });
    try {
        const slotRes = await db.query('SELECT * FROM available_slots WHERE id = $1 AND academy_id = $2', [req.params.id, req.user.academy_id]);
        const slot = slotRes.rows[0];
        if (!slot) return res.status(404).json({ error: 'Slot not found' });
        await db.query('DELETE FROM available_slots WHERE id = $1 AND is_booked = false AND academy_id = $2', [req.params.id, req.user.academy_id]);
        // Delete from Google Calendar (non-blocking)
        if (slot?.google_event_id) {
            const teacherRes = await db.query('SELECT calendar_access_token, calendar_refresh_token FROM users WHERE id = $1', [req.user.id]);
            deleteCalendarEvent(teacherRes.rows[0], slot.google_event_id).catch(e =>
                console.error('[Calendar] Delete event error:', e.message)
            );
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Teacher assigns a student to a free slot
router.put('/api/calendar/slots/:id', authenticateJWT, requireTeacherOrAdmin, (req, res) => {
    const { student_id, is_booked } = req.body;
    const slotWhere = req.user.role === 'admin'
        ? 'WHERE id = $3 AND academy_id = $4'
        : 'WHERE id = $3 AND teacher_id = $4';
    const slotParam = req.user.role === 'admin' ? req.user.academy_id : req.user.id;
    db.query(
        `UPDATE available_slots SET student_id = $1, is_booked = $2 ${slotWhere}`,
        [student_id, is_booked, req.params.id, slotParam],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// Student books a slot
router.post('/api/calendar/slots/:id/book', authenticateJWT, requireStudent, async (req, res) => {
    try {
        const studentRes = await db.query('SELECT id, name FROM students WHERE user_id = $1', [req.user.id]);
        if (!studentRes.rows[0]) return res.status(404).json({ error: 'Student not found' });
        const studentId = studentRes.rows[0].id;

        const upRes = await db.query(
            'UPDATE available_slots SET is_booked = true, student_id = $1 WHERE id = $2 AND is_booked = false',
            [studentId, req.params.id]
        );
        if (upRes.rowCount === 0) return res.status(400).json({ error: 'Slot ya reservado' });

        // Generate session record and get slot data
        const slotRes = await db.query('SELECT * FROM available_slots WHERE id = $1', [req.params.id]);
        if (slotRes.rows[0]) {
            const slot = slotRes.rows[0];
            const dt = slot.start_datetime.split('T')[0];
            await db.query(
                'INSERT INTO sessions (student_id, date, duration_minutes, homework_done, slot_id) VALUES ($1, $2, 60, false, $3)',
                [studentId, dt, req.params.id]
            );

            // Update Google Calendar event with student as attendee (non-blocking)
            if (slot.google_event_id) {
                (async () => {
                    try {
                        const teacherRes = await db.query('SELECT * FROM users WHERE id = $1', [slot.teacher_id]);
                        const studentUserRes = await db.query('SELECT email FROM users WHERE id = $1', [req.user.id]);
                        const teacher = teacherRes.rows[0];
                        const studentEmail = studentUserRes.rows[0]?.email;
                        if (teacher?.calendar_access_token && studentEmail) {
                            const auth = makeOAuth2Client();
                            auth.setCredentials({ access_token: teacher.calendar_access_token, refresh_token: teacher.calendar_refresh_token });
                            const gcal = google.calendar({ version: 'v3', auth });
                            const existing = await gcal.events.get({ calendarId: 'primary', eventId: slot.google_event_id });
                            const attendees = [...(existing.data.attendees || []), { email: studentEmail }];
                            await gcal.events.patch({
                                calendarId: 'primary',
                                eventId: slot.google_event_id,
                                resource: { attendees },
                                sendUpdates: 'all'
                            });
                        }
                    } catch (e) {
                        console.error('[Calendar] Book update error:', e.message);
                    }
                })();
            }
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Student cancels slot booking
router.post('/api/calendar/slots/:id/cancel', authenticateJWT, requireStudent, (req, res) => {
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

router.get('/api/calendar/connect', authenticateJWT, requireTeacherOrAdmin, (req, res) => {
    const calendarRedirectUri = (process.env.BASE_URL || '') + '/api/calendar/callback';
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        calendarRedirectUri
    );
    const nonce = crypto.randomBytes(8).toString('hex');
    const stateData = `${req.user.id}:${nonce}`;
    const sig = crypto.createHmac('sha256', JWT_SECRET).update(stateData).digest('hex').substring(0, 16);
    const signedState = Buffer.from(JSON.stringify({ d: stateData, s: sig })).toString('base64');
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/calendar.events'
        ],
        state: signedState
    });
    res.json({ authUrl });
});

router.get('/api/calendar/callback', async (req, res) => {
    try {
        const { code, state: rawState } = req.query;
        // Verify HMAC-signed state to prevent account takeover
        let userId;
        try {
            const parsed = JSON.parse(Buffer.from(rawState, 'base64').toString());
            const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(parsed.d).digest('hex').substring(0, 16);
            if (parsed.s !== expectedSig) throw new Error('Invalid state signature');
            userId = parsed.d.split(':')[0];
            if (!userId || isNaN(Number(userId))) throw new Error('Invalid userId in state');
        } catch (e) {
            console.error('[Calendar] Invalid state:', e.message);
            return res.redirect('/teacher/settings?calendar=error');
        }
        const calendarRedirectUri = (process.env.BASE_URL || '') + '/api/calendar/callback';
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            calendarRedirectUri
        );
        const { tokens } = await oauth2Client.getToken(code);
        await db.query(
            'UPDATE users SET calendar_access_token=$1, calendar_refresh_token=$2, calendar_token_expiry=$3 WHERE id=$4',
            [tokens.access_token, tokens.refresh_token, tokens.expiry_date, userId]
        );
        console.log('[Calendar] Connected for user:', userId);
        res.redirect('/teacher/settings?calendar=connected');
    } catch (err) {
        console.error('[Calendar] Callback error:', err.message);
        res.redirect('/teacher/settings?calendar=error');
    }
});

router.get('/api/calendar/status', authenticateJWT, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT calendar_access_token FROM users WHERE id=$1',
            [req.user.id]
        );
        const user = result.rows[0];
        res.json({ connected: !!user?.calendar_access_token });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
