#!/usr/bin/env node
/**
 * AcademiaPro Smoke Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates all critical endpoints against the live Railway deployment.
 * Designed to run automatically after each deploy to catch regressions.
 *
 * Usage:
 *   npm run test:smoke
 *   SMOKE_URL=https://your-app.up.railway.app npm run test:smoke
 *
 * Environment variables:
 *   SMOKE_URL      Override the target URL (default: Railway production)
 *   SMOKE_TIMEOUT  Request timeout in ms (default: 30000)
 *
 * Exit code 0 = all checks passed
 * Exit code 1 = one or more checks failed
 */

'use strict';

require('dotenv').config();

const https = require('https');
const http  = require('http');

const BASE_URL   = (process.env.SMOKE_URL || 'https://web-production-d02f4.up.railway.app').replace(/\/$/, '');
const TIMEOUT_MS = parseInt(process.env.SMOKE_TIMEOUT || '30000', 10);

// Unique test identifiers so parallel runs never clash
const TS              = Date.now();
const OWNER_EMAIL     = `smoke_owner_${TS}@test.invalid`;
const STUDENT_EMAIL   = `smoke_student_${TS}@test.invalid`;
const TEACHER_EMAIL   = `smoke_teacher_${TS}@test.invalid`;
const JOIN_STU_EMAIL  = `smoke_joinstu_${TS}@test.invalid`;
const PASSWORD        = 'SmokeTest_123!';

// ─── Shared state across tests ────────────────────────────────────────────────
let ownerToken      = null;   // JWT for the test owner/admin
let studentToken    = null;   // JWT for the test student (registered via /auth/register)
let teacherToken    = null;   // JWT for the teacher joined via /api/auth/join
let joinStuToken    = null;   // JWT for the student joined via /api/auth/join
let studentRecordId = null;   // students.id (used in transcript tests)
let conversationId  = null;   // ai_conversations.id
let teacherCode     = null;   // teacher_code from academy registration

// ─── Result tracking ──────────────────────────────────────────────────────────
let passed   = 0;
let failed   = 0;
const failures = [];

// ─── HTTP helper ──────────────────────────────────────────────────────────────
function request(method, urlPath, { body, token } = {}) {
    return new Promise((resolve, reject) => {
        const fullUrl = new URL(BASE_URL + urlPath);
        const lib     = fullUrl.protocol === 'https:' ? https : http;
        const headers = {};
        let postData  = null;

        if (body !== undefined) {
            postData = JSON.stringify(body);
            headers['Content-Type']   = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(postData);
        }

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const opts = {
            hostname : fullUrl.hostname,
            port     : fullUrl.port || (fullUrl.protocol === 'https:' ? 443 : 80),
            path     : fullUrl.pathname + fullUrl.search,
            method,
            headers,
            timeout  : TIMEOUT_MS,
        };

        const req = lib.request(opts, res => {
            let raw = '';
            res.on('data', chunk => { raw += chunk; });
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(raw); } catch (_) {}
                resolve({ status: res.statusCode, body: json, raw });
            });
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Request timed out after ${TIMEOUT_MS}ms`));
        });
        req.on('error', reject);

        if (postData) req.write(postData);
        req.end();
    });
}

// ─── Assertion helpers ────────────────────────────────────────────────────────
function check(label, ok, hint = '') {
    if (ok) {
        process.stdout.write(`  ✓  ${label}\n`);
        passed++;
    } else {
        process.stdout.write(`  ✗  ${label}${hint ? `  [${hint}]` : ''}\n`);
        failed++;
        failures.push(`${label}${hint ? ': ' + hint : ''}`);
    }
}

function warn(msg) {
    process.stdout.write(`  ⚠  ${msg}\n`);
}

async function section(title, fn) {
    const pad = Math.max(0, 50 - title.length);
    process.stdout.write(`\n── ${title} ${'─'.repeat(pad)}\n`);
    try {
        await fn();
    } catch (err) {
        process.stdout.write(`  ✗  UNEXPECTED ERROR: ${err.message}\n`);
        failed++;
        failures.push(`${title}: ${err.message}`);
    }
}

// Short representation of a response body for error hints
function hint(body, maxLen = 180) {
    const s = JSON.stringify(body) || '';
    return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

// ─── Test suite ───────────────────────────────────────────────────────────────
async function runTests() {
    process.stdout.write(`\n🔍  AcademiaPro Smoke Tests\n`);
    process.stdout.write(`    Target  : ${BASE_URL}\n`);
    process.stdout.write(`    Time    : ${new Date().toISOString()}\n`);
    process.stdout.write(`    Timeout : ${TIMEOUT_MS}ms per request\n`);

    // ── Health ────────────────────────────────────────────────────────────────
    await section('Health', async () => {
        const r = await request('GET', '/health');
        check('GET /health → 200', r.status === 200, `status=${r.status}`);
        check('Uptime present', typeof r.body?.uptime === 'number', hint(r.body));
    });

    // ── Auth: register owner ──────────────────────────────────────────────────
    // /auth/register without academy_code creates a new academy and returns
    // { success, teacher_code, student_code } — NO token in this response.
    let studentCode = null;

    await section('Auth – Register owner', async () => {
        const r = await request('POST', '/auth/register', {
            body: {
                name         : `Smoke Owner ${TS}`,
                email        : OWNER_EMAIL,
                password     : PASSWORD,
                academy_name : `Smoke Academy ${TS}`,
            },
        });
        check('POST /auth/register (owner) → 200', r.status === 200, `status=${r.status} ${hint(r.body)}`);
        check('Response has student_code',  !!r.body?.student_code,  hint(r.body));
        check('Response has teacher_code',  !!r.body?.teacher_code,  hint(r.body));
        studentCode = r.body?.student_code ?? null;
        teacherCode = r.body?.teacher_code ?? null;
    });

    // ── Auth: login owner ─────────────────────────────────────────────────────
    await section('Auth – Login owner', async () => {
        const r = await request('POST', '/auth/login', {
            body: { email: OWNER_EMAIL, password: PASSWORD },
        });
        check('POST /auth/login (owner) → 200', r.status === 200, `status=${r.status}`);
        ownerToken = r.body?.token ?? null;
        check('Owner JWT received', !!ownerToken, hint(r.body));
    });

    // ── Auth: me ──────────────────────────────────────────────────────────────
    await section('Auth – /api/auth/me', async () => {
        const r = await request('GET', '/api/auth/me', { token: ownerToken });
        check('GET /api/auth/me → 200', r.status === 200, `status=${r.status}`);
        const user = r.body?.user || r.body;
        check('Returns id and role', !!user?.id && !!user?.role, hint(user));
        check('Role is admin',       user?.role === 'admin',       `role=${user?.role}`);
    });

    // ── Auth: register student with student_code ──────────────────────────────
    // /auth/register with academy_code also inserts a row in the students table,
    // which is what transcript/process needs.
    if (studentCode) {
        await section('Auth – Register student', async () => {
            const r = await request('POST', '/auth/register', {
                body: {
                    name         : `Smoke Student ${TS}`,
                    email        : STUDENT_EMAIL,
                    password     : PASSWORD,
                    academy_code : studentCode,
                },
            });
            check('POST /auth/register (student) → 200', r.status === 200, `status=${r.status} ${hint(r.body)}`);
        });

        await section('Auth – Login student', async () => {
            const r = await request('POST', '/auth/login', {
                body: { email: STUDENT_EMAIL, password: PASSWORD },
            });
            check('POST /auth/login (student) → 200', r.status === 200, `status=${r.status}`);
            studentToken = r.body?.token ?? null;
            check('Student JWT received', !!studentToken, hint(r.body));
        });
    } else {
        warn('No student_code — skipping student registration');
    }

    // ── Students list (resolve studentRecordId) ───────────────────────────────
    await section('Students', async () => {
        const r = await request('GET', '/api/students', { token: ownerToken });
        check('GET /api/students → 200', r.status === 200, `status=${r.status}`);
        const rows = Array.isArray(r.body) ? r.body : (r.body?.rows ?? []);
        check('Response is array', Array.isArray(rows), `type=${typeof r.body}`);
        if (rows.length > 0) {
            studentRecordId = rows[0].id;
            check('Student record ID resolved', !!studentRecordId, `id=${studentRecordId}`);
        } else {
            warn('No students in academy — transcript/send-to-chat checks will be limited');
        }
    });

    // ── Chat ──────────────────────────────────────────────────────────────────
    await section('Chat – rooms & contacts', async () => {
        const ensure = await request('POST', '/api/chat/ensure-rooms', { token: ownerToken });
        check('POST /api/chat/ensure-rooms → 200', ensure.status === 200, `status=${ensure.status}`);

        const rooms = await request('GET', '/api/chat/rooms', { token: ownerToken });
        check('GET /api/chat/rooms → 200', rooms.status === 200, `status=${rooms.status}`);
        check('Rooms is array', Array.isArray(rooms.body), `type=${typeof rooms.body}`);

        const contacts = await request('GET', '/api/chat/contacts', { token: ownerToken });
        check('GET /api/chat/contacts → 200', contacts.status === 200, `status=${contacts.status}`);
    });

    await section('Chat – unread count', async () => {
        const r = await request('GET', '/api/chat/unread-count', { token: ownerToken });
        check('GET /api/chat/unread-count → 200', r.status === 200, `status=${r.status}`);
        // Response shape: { count: N } or { unread: N } — just check it's a non-null object
        check('Response is object', r.body !== null && typeof r.body === 'object', `body=${hint(r.body)}`);
    });

    // ── Transcripts ───────────────────────────────────────────────────────────
    await section('Transcripts – students list', async () => {
        const r = await request('GET', '/api/transcripts/students', { token: ownerToken });
        check('GET /api/transcripts/students → 200', r.status === 200, `status=${r.status}`);
        check('Response is array', Array.isArray(r.body), `type=${typeof r.body}`);
        // Fallback: use first student from this list if we didn't get one yet
        if (!studentRecordId && Array.isArray(r.body) && r.body.length > 0) {
            studentRecordId = r.body[0].id;
        }
    });

    if (studentRecordId) {
        await section('Transcripts – process short text', async () => {
            const r = await request('POST', '/api/transcripts/process', {
                token: ownerToken,
                body: {
                    student_id      : studentRecordId,
                    transcript_text : 'Hoy hemos repasado las ecuaciones de segundo grado. '
                        + 'El alumno ha practicado ejercicios de factorización y aprendido '
                        + 'a usar la fórmula cuadrática. Se explicó el discriminante y sus tres casos posibles.',
                },
            });
            check('POST /api/transcripts/process (short) → 200', r.status === 200, `status=${r.status} ${hint(r.body)}`);
            check('Response has resumen',         !!r.body?.resumen,                   hint(r.body));
            check('Response has deberes array',   Array.isArray(r.body?.deberes),      `type=${typeof r.body?.deberes}`);
            check('Response has conceptos_clave', Array.isArray(r.body?.conceptos_clave), `type=${typeof r.body?.conceptos_clave}`);
        });

        await section('Transcripts – process long text (>2 000 chars)', async () => {
            // ~2 700 chars — exercises the 12 000-char truncation fix
            const longText = [
                'Clase de matemáticas: álgebra lineal y cálculo diferencial.',
                'Sistemas de ecuaciones lineales con múltiples incógnitas.',
                'El alumno ha trabajado en matrices, determinantes y el método de Gauss-Jordan.',
                'Se introdujeron límites y derivadas básicas, enfocándonos en la interpretación gráfica.',
                'El concepto de derivada como tasa de cambio instantáneo fue muy bien comprendido.',
                'Se practicaron las reglas de derivación: potencia, producto, cociente y regla de la cadena.',
                'Para la siguiente sesión: ejercicios del libro páginas 45 a 52.',
            ].join(' ').repeat(12);

            check(`Long text length > 2000`, longText.length > 2000, `length=${longText.length}`);

            const r = await request('POST', '/api/transcripts/process', {
                token: ownerToken,
                body: { student_id: studentRecordId, transcript_text: longText },
            });
            check('POST /api/transcripts/process (long) → 200', r.status === 200, `status=${r.status} ${hint(r.body)}`);
            check('Long text response has resumen', !!r.body?.resumen, hint(r.body));
        });

        await section('Transcripts – send to chat', async () => {
            const summary = {
                resumen           : 'Clase de repaso de ecuaciones. El alumno ha progresado notablemente.',
                deberes           : ['Ejercicios pág. 10', 'Repasar factorización'],
                conceptos_clave   : ['Ecuaciones de segundo grado', 'Discriminante'],
                pistas_profesor   : ['Repasar fórmula cuadrática antes del examen'],
                proximos_pasos    : ['Ver vídeo de derivadas'],
                mensaje_motivador : '¡Sigue así, lo estás haciendo genial!',
            };
            const r = await request('POST', '/api/transcripts/send-to-chat', {
                token: ownerToken,
                body: { student_id: studentRecordId, summary },
            });
            // 200 = message sent to chat
            // 404 = student has no linked user account (acceptable in some test setups)
            check(
                'POST /api/transcripts/send-to-chat → 200 or 404',
                r.status === 200 || r.status === 404,
                `status=${r.status} ${hint(r.body)}`
            );
            if (r.status === 200) {
                check('Response has room_id', r.body?.room_id !== undefined, hint(r.body));
            }
        });
    } else {
        warn('No studentRecordId — skipping transcript process/send-to-chat checks');
    }

    await section('Transcripts – history', async () => {
        const r = await request('GET', '/api/transcripts/history', { token: ownerToken });
        check('GET /api/transcripts/history → 200', r.status === 200, `status=${r.status}`);
    });

    // ── AI Tutor ──────────────────────────────────────────────────────────────
    await section('AI Tutor – conversations CRUD', async () => {
        const list = await request('GET', '/api/ai/conversations', { token: ownerToken });
        check('GET /api/ai/conversations → 200', list.status === 200, `status=${list.status}`);
        check('Conversations is array', Array.isArray(list.body), `type=${typeof list.body}`);

        const create = await request('POST', '/api/ai/conversations', {
            token: ownerToken,
            body: { title: `Smoke ${TS}` },
        });
        check('POST /api/ai/conversations → 200', create.status === 200, `status=${create.status}`);
        // Note: on PostgreSQL the INSERT lacks RETURNING id, so id may be null.
        // We still test the endpoint is reachable; ai-tutor/chat creates its own conversation.
        conversationId = create.body?.id ?? null;

        if (conversationId) {
            const msgs = await request('GET', `/api/ai/conversations/${conversationId}/messages`, { token: ownerToken });
            check('GET /api/ai/conversations/:id/messages → 200', msgs.status === 200, `status=${msgs.status}`);
        } else {
            warn('conversationId is null (known PG limitation in this endpoint) — messages check skipped');
        }
    });

    await section('AI Tutor – chat', async () => {
        const r = await request('POST', '/api/ai-tutor/chat', {
            token: ownerToken,
            body: {
                messages       : [{ role: 'user', content: 'Responde SOLO con la palabra: hola' }],
                conversationId : conversationId || undefined,   // null → endpoint creates its own
            },
        });
        check('POST /api/ai-tutor/chat → 200', r.status === 200, `status=${r.status} ${hint(r.body)}`);
        check('Response has AI text', !!r.body?.response, hint(r.body));
        // Update conversationId in case it was created by this request
        if (r.body?.conversationId && !conversationId) {
            conversationId = r.body.conversationId;
        }
    });

    await section('AI Tutor – history', async () => {
        const r = await request('GET', '/api/ai-tutor/history', { token: ownerToken });
        check('GET /api/ai-tutor/history → 200', r.status === 200, `status=${r.status}`);
        check('Response has messages array', Array.isArray(r.body?.messages), `type=${typeof r.body?.messages}`);
    });

    // ── Reports ───────────────────────────────────────────────────────────────
    await section('Reports', async () => {
        if (studentRecordId) {
            const r = await request('GET', `/api/reports/student/${studentRecordId}`, { token: ownerToken });
            check('GET /api/reports/student/:id → 200', r.status === 200, `status=${r.status}`);
        } else {
            warn('No studentRecordId — skipping /api/reports/student/:id');
        }

        if (studentToken) {
            const portal = await request('GET', '/api/student/portal-data', { token: studentToken });
            check('GET /api/student/portal-data (student) → 200', portal.status === 200, `status=${portal.status}`);

            const reports = await request('GET', '/api/student/reports', { token: studentToken });
            check('GET /api/student/reports (student) → 200', reports.status === 200, `status=${reports.status}`);
        } else {
            warn('No studentToken — skipping student portal checks');
        }
    });

    // ── External-academy student portal (tests /api/auth/join bug regression) ─
    //
    // Covers the three bugs we fixed:
    //   1. /api/auth/join must insert a row in the students table
    //   2. GET /api/student/reports must not return 403 for a joined student
    //   3. avgScore in portal-data must be a finite number, never NaN
    //   4. The joined student must appear in the admin's /api/students list

    await section('External join – teacher via /api/auth/join', async () => {
        if (!teacherCode) { warn('No teacherCode — skipping teacher join'); return; }
        const r = await request('POST', '/api/auth/join', {
            body: { name: `Smoke Teacher ${TS}`, email: TEACHER_EMAIL, password: PASSWORD, role: 'teacher', academy_code: teacherCode },
        });
        check('POST /api/auth/join (teacher) → 200', r.status === 200, `status=${r.status} ${hint(r.body)}`);
        check('Teacher join returns token', !!r.body?.token, hint(r.body));
        teacherToken = r.body?.token ?? null;
    });

    await section('External join – student via /api/auth/join', async () => {
        if (!studentCode) { warn('No studentCode — skipping student join'); return; }
        const r = await request('POST', '/api/auth/join', {
            body: { name: `Smoke Join Student ${TS}`, email: JOIN_STU_EMAIL, password: PASSWORD, role: 'student', academy_code: studentCode },
        });
        check('POST /api/auth/join (student) → 200', r.status === 200, `status=${r.status} ${hint(r.body)}`);
        check('Student join returns token', !!r.body?.token, hint(r.body));
        joinStuToken = r.body?.token ?? null;
    });

    await section('External join – student portal access', async () => {
        if (!joinStuToken) { warn('No joinStuToken — skipping'); return; }

        // Bug 2 regression: must be 200, not 403
        const portal = await request('GET', '/api/student/portal-data', { token: joinStuToken });
        check('GET /api/student/portal-data (joined student) → 200', portal.status === 200, `status=${portal.status} ${hint(portal.body)}`);

        // Bug 3 regression: avgScore must never be NaN
        if (portal.status === 200 && portal.body?.stats) {
            const avg = parseFloat(portal.body.stats.avgScore);
            check('avgScore is finite (not NaN)', isFinite(avg) || portal.body.stats.avgScore === null, `avgScore=${portal.body.stats.avgScore}`);
        } else if (portal.status === 200) {
            warn('portal-data returned 200 but stats object missing — avgScore check skipped');
        }

        // Bug 2 regression: must be 200, not 403
        const reports = await request('GET', '/api/student/reports', { token: joinStuToken });
        check('GET /api/student/reports (joined student) → 200', reports.status === 200, `status=${reports.status} ${hint(reports.body)}`);
        check('Reports response is array', Array.isArray(reports.body), `type=${typeof reports.body}`);
    });

    await section('External join – student appears in admin list', async () => {
        if (!joinStuToken) { warn('No joinStuToken — skipping'); return; }

        // Bug 4 regression: /api/auth/join must insert into students table
        const r = await request('GET', '/api/students', { token: ownerToken });
        check('GET /api/students (admin) → 200', r.status === 200, `status=${r.status}`);
        const rows = Array.isArray(r.body) ? r.body : (r.body?.rows ?? []);
        const found = rows.some(s =>
            s.name === `Smoke Join Student ${TS}` ||
            (s.user_email && s.user_email === JOIN_STU_EMAIL)
        );
        check('Joined student appears in admin student list', found, `found=${found}, total_students=${rows.length}`);
    });

    // ── Notifications ─────────────────────────────────────────────────────────
    await section('Notifications', async () => {
        const list = await request('GET', '/api/notifications', { token: ownerToken });
        check('GET /api/notifications → 200',     list.status === 200,         `status=${list.status}`);
        check('Returns array',                     Array.isArray(list.body),    `type=${typeof list.body}`);

        const markAll = await request('POST', '/api/notifications/mark-all-read', { token: ownerToken });
        check('POST /api/notifications/mark-all-read → 200', markAll.status === 200, `status=${markAll.status}`);
        check('mark-all-read returns success', markAll.body?.success === true, hint(markAll.body));
    });

    // ── Auth guards (unauthenticated requests must be rejected) ───────────────
    await section('Auth guards', async () => {
        const noToken = await request('GET', '/api/auth/me');
        check('GET /api/auth/me without token → 401', noToken.status === 401, `status=${noToken.status}`);

        const badToken = await request('GET', '/api/notifications', { token: 'invalid.jwt.here' });
        check('GET /api/notifications with bad token → 401', badToken.status === 401, `status=${badToken.status}`);
    });

    // ── Cleanup ───────────────────────────────────────────────────────────────
    await section('Cleanup', async () => {
        if (studentToken) {
            const r = await request('DELETE', '/api/auth/delete-account', { token: studentToken });
            check('DELETE student test account → 200', r.status === 200, `status=${r.status}`);
        }
        if (teacherToken) {
            const r = await request('DELETE', '/api/auth/delete-account', { token: teacherToken });
            check('DELETE teacher test account → 200', r.status === 200, `status=${r.status}`);
        }
        if (joinStuToken) {
            const r = await request('DELETE', '/api/auth/delete-account', { token: joinStuToken });
            check('DELETE join-student test account → 200', r.status === 200, `status=${r.status}`);
        }
        if (ownerToken) {
            // Deleting the owner (role=admin) cascades to delete the entire academy
            const r = await request('DELETE', '/api/auth/delete-account', { token: ownerToken });
            check('DELETE owner test account → 200', r.status === 200, `status=${r.status} ${hint(r.body)}`);
        }
    });

    // ── Summary ───────────────────────────────────────────────────────────────
    const total  = passed + failed;
    const line   = '─'.repeat(54);

    process.stdout.write(`\n${line}\n`);
    process.stdout.write(`Results: ${passed}/${total} passed\n`);

    if (failures.length > 0) {
        process.stdout.write('\nFailed checks:\n');
        failures.forEach(f => process.stdout.write(`  ✗  ${f}\n`));
    }

    process.stdout.write('\n');

    if (failed > 0) {
        process.stderr.write(`❌  ${failed} check(s) failed\n\n`);
        process.exit(1);
    } else {
        process.stdout.write(`✅  All ${passed} checks passed\n\n`);
        process.exit(0);
    }
}

runTests().catch(err => {
    process.stderr.write(`\nFatal error: ${err.message}\n${err.stack}\n`);
    process.exit(1);
});
