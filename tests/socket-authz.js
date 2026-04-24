#!/usr/bin/env node
'use strict';

require('dotenv').config();

const https = require('https');
const http = require('http');
const { io } = require('socket.io-client');

const BASE_URL = (process.env.SMOKE_URL || 'https://web-production-d02f4.up.railway.app').replace(/\/$/, '');
const TIMEOUT_MS = parseInt(process.env.SMOKE_TIMEOUT || '30000', 10);

const TS = Date.now();
const OWNER_EMAIL = `socket_owner_${TS}@test.invalid`;
const STUDENT_EMAIL = `socket_student_${TS}@test.invalid`;
const TEACHER_EMAIL = `socket_teacher_${TS}@test.invalid`;
const PASSWORD = 'SocketTest_123!';
const TEACHER_NAME = `Socket Teacher ${TS}`;

let ownerCookie = null;
let studentCookie = null;
let teacherCookie = null;

function request(method, urlPath, { body, cookie } = {}) {
    return new Promise((resolve, reject) => {
        const fullUrl = new URL(BASE_URL + urlPath);
        const lib = fullUrl.protocol === 'https:' ? https : http;
        const headers = {};
        let postData = null;

        if (body !== undefined) {
            postData = JSON.stringify(body);
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(postData);
        }

        if (cookie) headers['Cookie'] = cookie;

        const req = lib.request({
            hostname: fullUrl.hostname,
            port: fullUrl.port || (fullUrl.protocol === 'https:' ? 443 : 80),
            path: fullUrl.pathname + fullUrl.search,
            method,
            headers,
            timeout: TIMEOUT_MS,
        }, res => {
            let raw = '';
            res.on('data', chunk => { raw += chunk; });
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(raw); } catch (_) {}
                resolve({
                    status: res.statusCode,
                    body: json,
                    raw,
                    setCookie: res.headers['set-cookie'] || [],
                });
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

function extractTokenCookie(response) {
    const tokenCookie = (response.setCookie || []).find(cookie => cookie.startsWith('token='));
    return tokenCookie ? tokenCookie.split(';')[0] : null;
}

function tokenFromCookie(cookie) {
    return cookie && cookie.startsWith('token=') ? cookie.slice('token='.length) : null;
}

function createSocket(token) {
    return io(BASE_URL, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token },
        timeout: TIMEOUT_MS,
    });
}

function waitForConnect(socket, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} connection timeout`)), 10000);
        socket.once('connect', () => {
            clearTimeout(timer);
            resolve();
        });
        socket.once('connect_error', err => {
            clearTimeout(timer);
            reject(new Error(`${label} connect_error: ${err.message}`));
        });
    });
}

function waitForMessage(socket, timeoutMs) {
    return new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), timeoutMs);
        socket.once('new_message', msg => {
            clearTimeout(timer);
            resolve(msg);
        });
    });
}

async function cleanup() {
    if (studentCookie) await request('DELETE', '/api/auth/delete-account', { cookie: studentCookie }).catch(() => {});
    if (teacherCookie) await request('DELETE', '/api/auth/delete-account', { cookie: teacherCookie }).catch(() => {});
    if (ownerCookie) await request('DELETE', '/api/auth/delete-account', { cookie: ownerCookie }).catch(() => {});
}

async function main() {
    let teacherSocket;
    let studentSocket;

    try {
        const ownerReg = await request('POST', '/auth/register', {
            body: {
                name: `Socket Owner ${TS}`,
                email: OWNER_EMAIL,
                password: PASSWORD,
                academy_name: `Socket Academy ${TS}`,
            },
        });
        if (ownerReg.status !== 200 || !ownerReg.body?.teacher_code || !ownerReg.body?.student_code) {
            throw new Error(`Owner register failed: status=${ownerReg.status} body=${ownerReg.raw}`);
        }

        const ownerLogin = await request('POST', '/auth/login', {
            body: { email: OWNER_EMAIL, password: PASSWORD },
        });
        ownerCookie = extractTokenCookie(ownerLogin);
        if (ownerLogin.status !== 200 || !ownerCookie) {
            throw new Error(`Owner login failed: status=${ownerLogin.status} body=${ownerLogin.raw}`);
        }

        const teacherJoin = await request('POST', '/api/auth/join', {
            body: {
                name: TEACHER_NAME,
                email: TEACHER_EMAIL,
                password: PASSWORD,
                role: 'teacher',
                academy_code: ownerReg.body.teacher_code,
            },
        });
        teacherCookie = extractTokenCookie(teacherJoin);
        if (teacherJoin.status !== 200 || !teacherCookie) {
            throw new Error(`Teacher join failed: status=${teacherJoin.status} body=${teacherJoin.raw}`);
        }

        const studentReg = await request('POST', '/auth/register', {
            body: {
                name: `Socket Student ${TS}`,
                email: STUDENT_EMAIL,
                password: PASSWORD,
                academy_code: ownerReg.body.student_code,
            },
        });
        if (studentReg.status !== 200) {
            throw new Error(`Student register failed: status=${studentReg.status} body=${studentReg.raw}`);
        }

        const studentLogin = await request('POST', '/auth/login', {
            body: { email: STUDENT_EMAIL, password: PASSWORD },
        });
        studentCookie = extractTokenCookie(studentLogin);
        if (studentLogin.status !== 200 || !studentCookie) {
            throw new Error(`Student login failed: status=${studentLogin.status} body=${studentLogin.raw}`);
        }

        const ensure = await request('POST', '/api/chat/ensure-rooms', { cookie: ownerCookie });
        if (ensure.status !== 200) {
            throw new Error(`ensure-rooms failed: status=${ensure.status} body=${ensure.raw}`);
        }

        const rooms = await request('GET', '/api/chat/rooms', { cookie: ownerCookie });
        const teacherRoom = (rooms.body || []).find(room => room.type === 'direct' && room.name === TEACHER_NAME);
        if (rooms.status !== 200 || !teacherRoom?.id) {
            throw new Error(`Teacher direct room not found: status=${rooms.status} body=${rooms.raw}`);
        }

        teacherSocket = createSocket(tokenFromCookie(teacherCookie));
        studentSocket = createSocket(tokenFromCookie(studentCookie));
        await Promise.all([
            waitForConnect(teacherSocket, 'teacher'),
            waitForConnect(studentSocket, 'student'),
        ]);

        teacherSocket.emit('join_room', teacherRoom.id);
        studentSocket.emit('join_room', teacherRoom.id);
        await new Promise(resolve => setTimeout(resolve, 400));

        const teacherMessagePromise = waitForMessage(teacherSocket, 5000);
        const studentMessagePromise = waitForMessage(studentSocket, 1500);
        const text = `socket authz probe ${TS}`;

        const sendRes = await request('POST', `/api/chat/rooms/${teacherRoom.id}/messages`, {
            cookie: ownerCookie,
            body: { content: text },
        });
        if (sendRes.status !== 200) {
            throw new Error(`Room message send failed: status=${sendRes.status} body=${sendRes.raw}`);
        }

        const [teacherMsg, studentMsg] = await Promise.all([teacherMessagePromise, studentMessagePromise]);
        if (!teacherMsg || teacherMsg.content !== text) {
            throw new Error(`Authorized teacher socket did not receive the room message. payload=${JSON.stringify(teacherMsg)}`);
        }
        if (studentMsg) {
            throw new Error(`Unauthorized student socket received room message: ${JSON.stringify(studentMsg)}`);
        }

        process.stdout.write('PASS: unauthorized socket did not receive room traffic\n');
        process.exitCode = 0;
    } catch (err) {
        process.stderr.write(`FAIL: ${err.message}\n`);
        process.exitCode = 1;
    } finally {
        if (teacherSocket) teacherSocket.close();
        if (studentSocket) studentSocket.close();
        await cleanup();
    }
}

main().catch(async err => {
    process.stderr.write(`FAIL: ${err.message}\n`);
    await cleanup();
    process.exit(1);
});
