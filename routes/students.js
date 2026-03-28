'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticateJWT }          = require('../middleware/auth');
const { requireAdmin, requireStudent } = require('../middleware/roles');
const { ensureAcademyRooms }       = require('../services/rooms')(null);

// DELETE student from academy
router.delete('/api/admin/students/:id', authenticateJWT, requireAdmin, (req, res) => {
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

// CHANGE student's teacher
router.put('/api/admin/students/:id/teacher', authenticateJWT, requireAdmin, async (req, res) => {
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

router.get('/api/students', authenticateJWT, (req, res) => {
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

router.get('/api/students-list', authenticateJWT, (req, res) => {
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

router.get('/api/admin/unassigned-count', authenticateJWT, requireAdmin, (req, res) => {
    db.query('SELECT COUNT(*) as count FROM students WHERE academy_id = $1 AND assigned_teacher_id IS NULL', [req.user.academy_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ count: result.rows[0]?.count || 0 });
    });
});

router.post('/api/admin/add-user-by-code', authenticateJWT, requireAdmin, async (req, res) => {
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

router.put('/api/students/:id', authenticateJWT, requireAdmin, (req, res) => {
    const ALLOWED_COLUMNS = new Set(['name', 'course', 'subject', 'status', 'parent_email', 'parent_phone',
        'notes', 'hourly_rate', 'monthly_fee', 'payment_day', 'payment_method',
        'payment_notes', 'payment_start_date', 'join_date', 'assigned_teacher_id']);
    const keys = Object.keys(req.body).filter(k => ALLOWED_COLUMNS.has(k));
    if (keys.length === 0) return res.status(400).json({ error: 'No hay campos válidos para actualizar' });
    const values = keys.map(k => req.body[k]);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(',');
    values.push(req.params.id, req.user.academy_id);
    const sql = `UPDATE students SET ${setClause} WHERE id = $${keys.length + 1} AND academy_id = $${keys.length + 2}`;
    db.query(sql, values, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

router.get('/api/student-detail/:id', authenticateJWT, (req, res) => {
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

router.get('/api/student/portal-data', authenticateJWT, async (req, res) => {
    try {
        let studentResult = await db.query(
            'SELECT * FROM students WHERE user_id = $1',
            [req.user.id]
        );
        let student = studentResult.rows?.[0] || studentResult[0] || null;

        if (!student) {
            try {
                // Auto-create student record if missing
                await db.query(
                    `INSERT INTO students (name, course, subject, status, academy_id, user_id)
                     VALUES ($1, 'Sin asignar', 'Sin asignar', 'active', $2, $3)`,
                    [req.user.name, req.user.academy_id, req.user.id]
                );
                const newResult = await db.query(
                    'SELECT * FROM students WHERE user_id = $1', [req.user.id]
                );
                student = newResult.rows?.[0] || newResult[0] || null;
            } catch(e) {
                console.error('Failed to auto-create student:', e.message);
            }
        }

        if (!student) {
            const defaultResponse = {
                student: { id: null, name: req.user.name, email: req.user.email, course: 'Sin asignar', subject: 'Sin asignar', status: 'active' },
                sessions: [], exams: [], payments: [],
                averageScore: 0, pendingPayments: 0, homeworkRate: 0
            };
            return res.json(defaultResponse);
        }

        let sessionsR = { rows: [] }, examsR = { rows: [] }, paymentsR = { rows: [] };

        try { sessionsR = await db.query('SELECT * FROM sessions WHERE student_id = $1 ORDER BY date DESC LIMIT 5', [student.id]); } catch(e) { console.error('sessions query error:', e.message); }
        try { examsR = await db.query('SELECT * FROM exams WHERE student_id = $1 ORDER BY date DESC LIMIT 5', [student.id]); } catch(e) { console.error('exams query error:', e.message); }
        try { paymentsR = await db.query('SELECT * FROM payments WHERE student_id = $1 ORDER BY due_date DESC LIMIT 5', [student.id]); } catch(e) { console.error('payments query error:', e.message); }

        const sessions = sessionsR.rows || [];
        const exams = examsR.rows || [];
        const payments = paymentsR.rows || [];

        res.json({
            student,
            sessions, exams, payments,
            averageScore: exams.length ? Math.round(exams.reduce((s, e) => s + (e.score || 0), 0) / exams.length * 10) / 10 : 0,
            pendingPayments: payments.filter(p => p.status === 'pending').reduce((s, p) => s + (p.amount || 0), 0),
            homeworkRate: sessions.length ? Math.round(sessions.filter(s => s.homework_done).length / sessions.length * 100) : 0
        });
    } catch (err) {
        console.error('Student portal full exception:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.get('/api/student/reports', authenticateJWT, requireStudent, (req, res) => {
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

module.exports = router;
