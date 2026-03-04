const fs = require('fs');
const path = require('path');

const adminFiles = ['index.html', 'admin_teachers.html', 'students.html', 'sessions.html', 'calendar.html', 'exams.html', 'payments.html', 'settings.html', 'admin_teacher_profile.html'];
const teacherFiles = ['teacher_dashboard.html', 'teacher_sessions.html', 'teacher_exams.html', 'teacher_calendar.html', 'teacher_settings.html', 'teacher_student_profile.html'];

adminFiles.forEach(f => {
    const p = path.join(__dirname, 'public', f);
    if (fs.existsSync(p)) {
        let content = fs.readFileSync(p, 'utf8');
        // Add link after exams or settings
        if (content.includes('<a href="/exams">📝 Exámenes</a>') && !content.includes('<a href="/admin/transcripts">')) {
            content = content.replace('<a href="/exams">📝 Exámenes</a>', '<a href="/exams">📝 Exámenes</a>\n            <a href="/admin/transcripts">📝 Transcripciones</a>');
            fs.writeFileSync(p, content);
        }
    }
});

teacherFiles.forEach(f => {
    const p = path.join(__dirname, 'public', f);
    if (fs.existsSync(p)) {
        let content = fs.readFileSync(p, 'utf8');
        // Add link after exams or settings
        if (content.includes('<a href="/teacher/exams">📝 Exámenes</a>') && !content.includes('<a href="/teacher/transcripts">')) {
            content = content.replace('<a href="/teacher/exams">📝 Exámenes</a>', '<a href="/teacher/exams">📝 Exámenes</a>\n            <a href="/teacher/transcripts">📝 Transcripciones</a>');
            fs.writeFileSync(p, content);
        }
    }
});
console.log("Sidebars updated.");
