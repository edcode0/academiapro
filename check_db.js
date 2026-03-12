const db = require('./db');

async function check() {
    try {
        const columns = await db.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('sessions', 'exams', 'payments', 'students') ORDER BY table_name, column_name`);
        console.log("COLUMNS:", columns.rows);
        
        const students = await db.query(`SELECT * FROM students`);
        console.log("STUDENTS:", students.rows);
        
        const studentUsers = await db.query(`SELECT id, name, email, role, academy_id FROM users WHERE role = 'student'`);
        console.log("STUDENT_USERS:", studentUsers.rows);

        const insert = await db.query(`INSERT INTO students (name, email, course, subject, status, academy_id, user_id) SELECT u.name, u.email, 'Sin asignar', 'Sin asignar', 'active', u.academy_id, u.id FROM users u WHERE u.role = 'student' AND u.id NOT IN (SELECT user_id FROM students WHERE user_id IS NOT NULL) RETURNING *`);
        console.log("INSERTED:", insert.rows);

    } catch (err) {
        console.error("ERROR:", err.message);
    }
    process.exit(0);
}

check();
