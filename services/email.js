'use strict';

const { Resend } = require('resend');

async function sendWelcomeEmail(user, academyName) {
    try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
            from:    'AcademiaPro <onboarding@resend.dev>',
            to:      user.email,
            subject: '¡Bienvenido a AcademiaPro! 🎓',
            html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Inter,sans-serif;background:#f8fafc;margin:0;padding:0}.container{max-width:600px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)}.header{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:40px;text-align:center}.header h1{color:white;margin:0;font-size:28px}.header p{color:rgba(255,255,255,.85);margin:8px 0 0}.body{padding:40px}.body h2{color:#1e293b;font-size:22px}.body p{color:#64748b;line-height:1.6}.steps{background:#f8fafc;border-radius:12px;padding:24px;margin:24px 0}.step{display:flex;align-items:flex-start;margin-bottom:16px}.step-num{background:#6366f1;color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0;margin-right:12px;margin-top:2px}.step-text{color:#374151}.step-text strong{color:#1e293b;display:block;margin-bottom:2px}.btn{display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;font-size:16px;margin:8px 0}.footer{background:#f8fafc;padding:24px 40px;text-align:center}.footer p{color:#94a3b8;font-size:13px;margin:0}</style></head><body><div class="container"><div class="header"><h1>🎓 AcademiaPro</h1><p>La plataforma inteligente para academias</p></div><div class="body"><h2>¡Hola, ${user.name}! 👋</h2><p>Tu academia <strong>${academyName || 'AcademiaPro'}</strong> ya está creada y lista para usar. Aquí tienes los primeros pasos para empezar:</p><div class="steps"><div class="step"><div class="step-num">1</div><div class="step-text"><strong>Comparte los códigos de tu academia</strong>Ve a Configuración y copia los códigos para profesores y alumnos</div></div><div class="step"><div class="step-num">2</div><div class="step-text"><strong>Añade tus primeros alumnos</strong>Desde el panel de Estudiantes puedes crear fichas individuales</div></div><div class="step"><div class="step-num">3</div><div class="step-text"><strong>Invita a tus profesores</strong>Comparte el código de profesor para que se unan a tu academia</div></div><div class="step"><div class="step-num">4</div><div class="step-text"><strong>Prueba el Tutor IA</strong>El asistente inteligente está disponible para profesores y alumnos</div></div></div><div style="text-align:center;margin:32px 0"><a href="${process.env.BASE_URL || 'https://web-production-d02f4.up.railway.app'}" class="btn">Ir a mi academia →</a></div><p style="font-size:14px;color:#94a3b8;text-align:center">¿Tienes alguna duda? Responde a este email y te ayudamos.</p></div><div class="footer"><p>AcademiaPro · La plataforma inteligente para academias de repaso</p></div></div></body></html>`
        });
        console.log('[Email] Welcome email sent to user id:', user.id);
    } catch (err) {
        console.error('[Email] Welcome email error:', err.message);
    }
}

async function sendJoinWelcomeEmail(user, academyName, role) {
    try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const roleText     = role === 'teacher' ? 'profesor' : 'alumno';
        const dashboardUrl = role === 'teacher' ? '/teacher' : '/student-portal';
        await resend.emails.send({
            from:    'AcademiaPro <onboarding@resend.dev>',
            to:      user.email,
            subject: `✅ Te has unido a ${academyName} en AcademiaPro`,
            html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Inter,sans-serif;background:#f8fafc;margin:0;padding:20px}.container{max-width:500px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)}.header{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:32px;text-align:center}.header h1{color:white;margin:0;font-size:24px}.body{padding:32px}.body p{color:#64748b;line-height:1.6}.btn{display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:600}.footer{padding:20px 32px;text-align:center;background:#f8fafc}.footer p{color:#94a3b8;font-size:13px;margin:0}</style></head><body><div class="container"><div class="header"><h1>🎓 AcademiaPro</h1></div><div class="body"><h2 style="color:#1e293b">¡Bienvenido, ${user.name}! 👋</h2><p>Te has unido a <strong>${academyName}</strong> como <strong>${roleText}</strong>. Ya puedes acceder a tu panel.</p><div style="text-align:center;margin:24px 0"><a href="${process.env.BASE_URL || 'https://web-production-d02f4.up.railway.app'}${dashboardUrl}" class="btn">Ir a mi panel →</a></div></div><div class="footer"><p>AcademiaPro · La plataforma inteligente para academias</p></div></div></body></html>`
        });
        console.log('[Email] Join welcome email sent to user id:', user.id);
    } catch (err) {
        console.error('[Email] Join welcome email error:', err.message);
    }
}

module.exports = { sendWelcomeEmail, sendJoinWelcomeEmail };
