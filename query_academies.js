const db = require('./db.js');

async function run() {
    try {
        const res1 = await db.query('SELECT id, name, teacher_code, student_code FROM academies;');
        console.log('--- ALL ACADEMIES (id, name, teacher_code, student_code) ---');
        console.log(JSON.stringify(res1.rows || res1, null, 2));

        const res2 = await db.query('SELECT * FROM academies LIMIT 10;');
        console.log('\n--- ALL ACADEMIES (ALL COLUMNS) LIMIT 10 ---');
        console.log(JSON.stringify(res2.rows || res2, null, 2));
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

run();
