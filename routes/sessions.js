'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticateJWT }    = require('../middleware/auth');
const { requireTeacherOrAdmin } = require('../middleware/roles');
const { checkStudentRisk }   = require('../services/risk');
const { createNotification } = require('../notifications');
const { deleteCalendarEvent } = require('../services/calendar');

router.post('/api/sessions', authenticateJWT, async (req, res) => {
    try {
        const { student_id, date, duration_minutes, homework_done, teacher_notes, notes, homework, session_type, students } = req.body;

        const sessionTypeVal = session_type || 'individual';
        const notesVal = teacher_notes || notes || '';
        const durationVal = duration_minutes || 60;
        const dateVal = date || new Date();
        const homeworkVal = homework_done || false;

        // Helper: insert one session row for a given student record and return the session
        const insertSession = async (sid, studentRecord) => {
            const result = await db.query(
                `INSERT INTO sessions (student_id, date, duration_minutes, homework_done, teacher_notes, session_type)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [sid, dateVal, durationVal, homeworkVal, notesVal, sessionTypeVal]
            );
            const session = result.rows[0];
            if (session) {
                checkStudentRisk(sid);
                const slotTeacherId = studentRecord.assigned_teacher_id || req.user.id;
                // Build local-time datetime strings to avoid UTC midnight shift
                const startTimeStr = req.body.start_time || null;
                const slotStart = date
                    ? (date.includes('T') ? date : `${date}T${startTimeStr || '09:00'}:00`)
                    : new Date().toISOString();
                const slotEnd = new Date(new Date(slotStart).getTime() + durationVal * 60000).toISOString();
                db.query(
                    `SELECT id FROM available_slots WHERE academy_id=$1 AND start_datetime=$2 AND student_id=$3`,
                    [req.user.academy_id, slotStart, sid]
                ).then(existing => {
                    const notifyStudent = (slotId) => {
                        db.query(`SELECT user_id, name, academy_id FROM students WHERE id = $1`, [sid], (err, r) => {
                            const st = r?.rows?.[0];
                            if (!err && st?.user_id) {
                                const dateStr = session.date ? new Date(session.date).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' }) : 'hoy';
                                createNotification(st.user_id, st.academy_id, 'session',
                                    '📅 Nueva sesión registrada',
                                    `Se ha registrado una sesión el ${dateStr} (${session.duration_minutes} min).`,
                                    `/student-portal/calendar?session=${slotId}`
                                );
                            }
                        });
                    };
                    if (existing.rows.length) { notifyStudent(existing.rows[0].id); return; }
                    return db.query(
                        `INSERT INTO available_slots (teacher_id, academy_id, start_datetime, end_datetime, is_booked, student_id, notes)
                         VALUES ($1, $2, $3, $4, TRUE, $5, $6) RETURNING id`,
                        [slotTeacherId, req.user.academy_id, slotStart, slotEnd, sid, notesVal]
                    ).then(slotResult => {
                        if (slotResult.rows.length) notifyStudent(slotResult.rows[0].id);
                    });
                }).catch(e => console.error('[Sessions] Auto-slot error:', e.message));
            }
            return session;
        };

        // Group session: insert one row per student in the array
        if (sessionTypeVal === 'group' && Array.isArray(students) && students.length > 0) {
            const createdSessions = [];
            for (const sid of students) {
                const ownershipQ = req.user.role === 'teacher'
                    ? await db.query('SELECT id, assigned_teacher_id FROM students WHERE id=$1 AND academy_id=$2 AND assigned_teacher_id=$3', [sid, req.user.academy_id, req.user.id])
                    : await db.query('SELECT id, assigned_teacher_id FROM students WHERE id=$1 AND academy_id=$2', [sid, req.user.academy_id]);
                const studentRecord = ownershipQ.rows[0];
                if (!studentRecord) continue; // skip students teacher doesn't own
                const session = await insertSession(sid, studentRecord);
                if (session) createdSessions.push(session);
            }
            return res.json(createdSessions);
        }

        // Individual session: existing behavior
        const ownershipQ = req.user.role === 'teacher'
            ? await db.query('SELECT id, assigned_teacher_id FROM students WHERE id=$1 AND academy_id=$2 AND assigned_teacher_id=$3', [student_id, req.user.academy_id, req.user.id])
            : await db.query('SELECT id, assigned_teacher_id FROM students WHERE id=$1 AND academy_id=$2', [student_id, req.user.academy_id]);
        const studentRecord = ownershipQ.rows[0];
        if (!studentRecord) return res.status(403).json({ error: 'Acceso denegado a este alumno' });

        const session = await insertSession(student_id, studentRecord);
        res.json(session);
    } catch (err) {
        console.error('Session error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.get('/api/sessions', authenticateJWT, (req, res) => {
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

router.get('/api/sessions-list', authenticateJWT, (req, res) => {
    // Scalar subqueries work on both PostgreSQL and SQLite.
    // SUBSTR(CAST(... AS TEXT), 1, 10) extracts "YYYY-MM-DD" from any datetime format.
    let sql = `SELECT s.*, st.name as student_name,
               (SELECT start_datetime FROM available_slots
                WHERE student_id = s.student_id AND academy_id = st.academy_id
                AND SUBSTR(CAST(start_datetime AS TEXT), 1, 10) = SUBSTR(CAST(s.date AS TEXT), 1, 10)
                ORDER BY start_datetime LIMIT 1) as slot_start_datetime,
               (SELECT end_datetime FROM available_slots
                WHERE student_id = s.student_id AND academy_id = st.academy_id
                AND SUBSTR(CAST(start_datetime AS TEXT), 1, 10) = SUBSTR(CAST(s.date AS TEXT), 1, 10)
                ORDER BY start_datetime LIMIT 1) as slot_end_datetime
               FROM sessions s
               JOIN students st ON s.student_id = st.id
               WHERE st.academy_id = $1`;
    let params = [req.user.academy_id];

    if (req.user.role === 'teacher') {
        sql += ' AND st.assigned_teacher_id = $2';
        params.push(req.user.id);
    }

    db.query(sql + ' ORDER BY s.date DESC, s.id DESC', params, (err, result) => {
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
                const sDate = new Date(typeof s.date === 'string' && !s.date.includes('T') ? s.date + 'T12:00:00' : s.date);
                const diff = (now - sDate) / (1000 * 60 * 60 * 24);
                return diff >= 0 && diff <= 7;
            }).length
        };

        res.json({ sessions: rows, stats });
    });
});

router.put('/api/sessions/:id', authenticateJWT, requireTeacherOrAdmin, async (req, res) => {
    try {
        const { date, duration_minutes, homework_done, teacher_notes } = req.body;
        const isTeacher = req.user.role === 'teacher';
        const sql = `UPDATE sessions SET date=$1, duration_minutes=$2, homework_done=$3, teacher_notes=$4
             WHERE id=$5 AND student_id IN (
                 SELECT id FROM students WHERE academy_id=$6${isTeacher ? ' AND assigned_teacher_id=$7' : ''}
             ) RETURNING *`;
        const params = isTeacher
            ? [date, duration_minutes, homework_done, teacher_notes, req.params.id, req.user.academy_id, req.user.id]
            : [date, duration_minutes, homework_done, teacher_notes, req.params.id, req.user.academy_id];
        const result = await db.query(sql, params);
        res.json(result.rows[0] || { updated: 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/api/sessions/:id', authenticateJWT, requireTeacherOrAdmin, async (req, res) => {
    try {
        // Get the session first to find its slot_id
        const sessionRes = await db.query(
            'SELECT * FROM sessions WHERE id=$1 AND student_id IN (SELECT id FROM students WHERE academy_id=$2)',
            [req.params.id, req.user.academy_id]
        );
        const session = sessionRes.rows[0];
        if (!session) return res.json({ success: true }); // already gone

        // If session has a slot, clean up the slot
        if (session.slot_id) {
            const slotRes = await db.query('SELECT * FROM available_slots WHERE id=$1', [session.slot_id]);
            const slot = slotRes.rows[0];
            if (slot) {
                // Delete Google Calendar event if exists (non-blocking)
                if (slot.google_event_id) {
                    const teacherRes = await db.query('SELECT calendar_access_token, calendar_refresh_token FROM users WHERE id=$1', [slot.teacher_id]);
                    deleteCalendarEvent(teacherRes.rows[0], slot.google_event_id).catch(e =>
                        console.error('[Sessions] Delete calendar event error:', e.message)
                    );
                }
                // Unbook the slot instead of deleting it
                await db.query('UPDATE available_slots SET is_booked=false, student_id=NULL WHERE id=$1', [session.slot_id]);
            }
        }

        // Delete the session — re-scope by academy_id to prevent cross-tenant delete
        await db.query(
            'DELETE FROM sessions WHERE id=$1 AND student_id IN (SELECT id FROM students WHERE academy_id=$2)',
            [req.params.id, req.user.academy_id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
