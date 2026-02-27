const db = require('./db');

const seed = () => {
    db.serialize(() => {
        // Clear existing data
        db.run('DELETE FROM payments');
        db.run('DELETE FROM exams');
        db.run('DELETE FROM sessions');
        db.run('DELETE FROM students');

        const students = [
            { name: 'María García', course: '2º Bachillerato', subject: 'Física y Química', status: 'active', join_date: '2024-01-10', parent_email: 'garcia.parents@email.com', parent_phone: '600111222' },
            { name: 'Carlos Martínez', course: '1º Bachillerato', subject: 'Matemáticas', status: 'active', join_date: '2024-02-05', parent_email: 'martinez.family@email.com', parent_phone: '600333444' },
            { name: 'Lucía Fernández', course: '4º ESO', subject: 'Física y Química', status: 'at_risk', join_date: '2024-01-20', parent_email: 'fernandez.home@email.com', parent_phone: '600555666' }
        ];

        students.forEach((s) => {
            db.run(
                `INSERT INTO students (name, course, subject, status, join_date, parent_email, parent_phone) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [s.name, s.course, s.subject, s.status, s.join_date, s.parent_email, s.parent_phone],
                function (err) {
                    if (err) return console.error(err.message);
                    const studentId = this.lastID;

                    // Add 2 recent sessions
                    db.run(`INSERT INTO sessions (student_id, date, duration_minutes, homework_done, teacher_notes) VALUES (?, ?, ?, ?, ?)`,
                        [studentId, '2024-02-20', 60, true, 'Buen progreso en los ejercicios de cinemática.']
                    );
                    db.run(`INSERT INTO sessions (student_id, date, duration_minutes, homework_done, teacher_notes) VALUES (?, ?, ?, ?, ?)`,
                        [studentId, '2024-02-22', 90, true, 'Repaso de termodinámica completado.']
                    );

                    // Add 1 pending payment
                    db.run(`INSERT INTO payments (student_id, amount, due_date, status) VALUES (?, ?, ?, ?)`,
                        [studentId, 120.00, '2024-03-01', 'pending']
                    );

                    console.log(`Added data for student: ${s.name}`);
                }
            );
        });
    });
};

seed();
