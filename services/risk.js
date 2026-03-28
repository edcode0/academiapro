'use strict';

const db                   = require('../db');
const { createNotification } = require('../notifications');

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
        const msg   = reason;
        if (row.admin_id)            createNotification(row.admin_id,            row.academy_id, 'at_risk', title, msg, null);
        if (row.assigned_teacher_id) createNotification(row.assigned_teacher_id, row.academy_id, 'at_risk', title, msg, null);
    } catch (e) {
        console.error('[notifyAtRisk]', e.message);
    }
}

module.exports = { checkStudentRisk, notifyAtRisk };
