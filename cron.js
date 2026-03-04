const db = require('./db');

function runDailyJobs() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const isFirstOfMonth = now.getDate() === 1;

    // 1. PAYMENT REMINDERS & AUTOGENERATEN
    db.query('SELECT s.key, s.value FROM settings s', (err, result) => {
        if (err || !result || !result.rows) return;
        const settings = {};
        result.rows.forEach(r => settings[r.key] = r.value);

        if (settings['notify_payment'] === 'true') {
            db.query(`SELECT p.*, st.parent_email, st.name as student_name, a.name as academy_name
                      FROM payments p
                      JOIN students st ON p.student_id = st.id
                      JOIN academies a ON st.academy_id = a.id
                      WHERE p.status = 'pendiente' AND p.due_date < $1`, [today], (err, pRes) => {
                if (!err && pRes && pRes.rows) {
                    pRes.rows.forEach(p => {
                        // send an email warning
                        if (p.parent_email && process.env.RESEND_API_KEY) {
                            fetch('https://api.resend.com/emails', {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    from: 'AcademiaPro <onboarding@resend.dev>',
                                    to: p.parent_email,
                                    subject: `Aviso: Pago vencido de ${p.student_name}`,
                                    html: `<p>Hola, le informamos que el pago correspondiente a ${p.amount}€ en la academia ${p.academy_name} se encuentra vencido desde ${p.due_date}. Por favor, póngase al corriente.</p>`
                                })
                            }).catch(e => console.error(e));
                        }
                    });
                }
            });
        }
    });

    // 2. TEACHER REPORT NOTIFICATION TO ADMIN ON 1ST OF MONTH
    if (isFirstOfMonth) {
        db.query('SELECT id, owner_id, name FROM academies', (err, acads) => {
            if (err || !acads || !acads.rows) return;
            acads.rows.forEach(async (acad) => {
                const month = now.getMonth() === 0 ? 12 : now.getMonth();
                const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

                try {
                    db.query('SELECT email FROM users WHERE id = $1', [acad.owner_id], async (eErr, userRes) => {
                        const adminEmail = userRes?.rows[0]?.email;
                        if (!adminEmail || !process.env.RESEND_API_KEY) return;

                        db.query(`SELECT p.*, u.name as teacher_name 
                                  FROM teacher_payments p 
                                  JOIN users u ON p.teacher_id = u.id 
                                  WHERE u.academy_id = $1 AND month = $2 AND year = $3`, [acad.id, month, year], (err, r) => {
                            if (!err && r && r.rows && r.rows.length > 0) {
                                let tableHtml = '<table border="1" cellpadding="5" cellspacing="0" style="width:100%; border-collapse:collapse; text-align:left;">';
                                tableHtml += '<tr style="background:#f1f5f9;"><th>Profesor</th><th>Horas</th><th>Tarifa</th><th>Total</th></tr>';
                                let grandTotal = 0;
                                r.rows.forEach(t => {
                                    tableHtml += `<tr><td>${t.teacher_name}</td><td>${t.hours.toFixed(1)}h</td><td>${t.hourly_rate}€/h</td><td>${t.total_amount}€</td></tr>`;
                                    grandTotal += t.total_amount;
                                });
                                tableHtml += `<tr><td colspan="3" align="right"><strong>Total:</strong></td><td><strong>${grandTotal}€</strong></td></tr></table>`;

                                fetch('https://api.resend.com/emails', {
                                    method: 'POST',
                                    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        from: 'AcademiaPro <onboarding@resend.dev>',
                                        to: adminEmail,
                                        subject: `Resumen mensual de profesores - ${acad.name} - ${month}/${year}`,
                                        html: `<h2>Resumen mensual</h2>${tableHtml}`
                                    })
                                }).catch(e => console.error(e));
                            }
                        });
                    });
                } catch (e) { }
            });
        });
    }
}

function initCrons() {
    if (global.cronsInitialized) return;
    global.cronsInitialized = true;

    if (global.dailyJobsTimeout) clearTimeout(global.dailyJobsTimeout);
    global.dailyJobsTimeout = setTimeout(runDailyJobs, 10000);

    if (global.dailyJobsInterval) clearInterval(global.dailyJobsInterval);
    global.dailyJobsInterval = setInterval(runDailyJobs, 1000 * 60 * 60 * 24);

    console.log('Crons initialized globally');
}

module.exports = initCrons;
