# Session Plan — 2026-03-28

## Bug Fixes: Group Session Selector + Teacher Rate Fields

### BUG 1 — teacher_dashboard.html: group student checkboxes not showing
- [ ] Fix `setDbSessionType('group')` line 743: change `''` → `'block'` for `db-group-students-container`

### BUG 2 — settings.html: Configuración de Profesores shows only one rate field
- [ ] Add `group_hourly_rate` input field to `teachers-config-list` render template
- [ ] Update `saveTeacherRate()` to read and send both `hourly_rate` AND `group_hourly_rate`

---

# Session Plan — 2026-03-25

## 4-Subagent Feature Sprint

### SA1 — Group Sessions
- [x] DB migration: ADD session_type VARCHAR(20) DEFAULT 'individual' to sessions
- [x] Backend: POST /api/sessions accepts session_type + students[] for group sessions
- [x] Frontend teacher_sessions.html: Individual/Grupal toggle, multi-select checkboxes, badge display
- [x] Frontend teacher_dashboard.html: same toggle + badge support

### SA2 — Group Hourly Rate per Teacher
- [x] DB migration: ADD group_hourly_rate NUMERIC DEFAULT 0 to users
- [x] Backend: teacher payment calculation uses individual × hourly_rate + group × group_hourly_rate
- [x] Frontend admin professors panel: two labeled rate fields, save independently
- [x] Frontend payment summary: breakdown (individual subtotal + group subtotal + total)

### SA3 — Fixed Academy Codes
- [ ] POST /auth/register: generate codes ONCE on academy creation, never change
- [ ] settings.html: remove "Regenerar Códigos" button, replace with read-only + copy button
- [ ] teacher_settings.html: same treatment
- [ ] Remove or protect PUT /api/academy/regenerate-codes endpoint
- [ ] Verify existing Railway academies already have codes (don't overwrite)

### SA4 — Help Assistant Floating Button
- [ ] Create public/help-assistant.js with floating button + chat panel
- [ ] POST /api/help-assistant/chat endpoint with role-based system prompts (Groq)
- [ ] Add <script src="/help-assistant.js"> to all main HTML pages

## Status
- [x] SA1 complete
- [x] SA2 complete
- [ ] SA3 complete
- [ ] SA4 complete
- [ ] git commit + push

---

---

# Plan: Refactoring index.js (4129 líneas → módulos)

## Estado: PENDIENTE DE APROBACIÓN

---

## AUDITORÍA: Lo que hay en index.js

### Tamaño real
- **4129 líneas** (no 1800 como se estimaba — el doble)

### Concerns mezclados (17 categorías)
1. Process error handlers (uncaughtException, unhandledRejection)
2. Database initialization
3. Email service — Resend (sendWelcomeEmail, sendJoinWelcomeEmail)
4. Google Calendar service (makeOAuth2Client, createCalendarEvent, deleteCalendarEvent)
5. Gmail/transcript auto-processor (checkAndProcessTranscripts)
6. Cron jobs (import de ./cron)
7. Express app + middleware (cors, bodyParser, session, passport, cookieParser)
8. Socket.io server + middleware JWT
9. Passport/Google OAuth strategy
10. JWT middleware (authenticateJWT)
11. Role middleware (requireRole, requireAdmin, requireTeacher, etc.)
12. **3 instancias Multer distintas** (pdfUpload, upload, chatUpload)
13. +100 rutas mezcladas
14. Business logic (checkStudentRisk, notifyAtRisk, ensureAcademyRooms, createDirectRoomIfNotExists)
15. Socket.io event handlers (sendMessage, typing, disconnect)
16. Interval timers (Gmail auto-check 15min, class reminder 1min)
17. PDF generation (inline en rutas)

### Conteo de rutas por categoría
| Categoría | Rutas | Líneas aprox. |
|-----------|-------|--------------|
| Auth + OAuth | 15 | 511-868 |
| Students | 10 | 2066-2230 |
| Teachers (admin) | 14 | 972-1183 |
| Sessions | 6 | 2231-2360 |
| Payments | 8 | 2362-2676 |
| Exams | 9 | 2428-3499 |
| Calendar (slots) | 8 | 1186-1371 |
| Chat | 12 | 2894-3214 |
| Transcripts | 4 | 1675-1943 |
| AI Tutor / Conversations | 12 | 1373-1541, 3236-3360 |
| Gmail | 6 | 1544-1673 |
| Notifications | 3 | 1977-2013 |
| Reports (generate) | 2 | 3637-3799 |
| Settings + Academy | 5 | 3602-3635, 3216-3232 |
| Onboarding | 2 | 3106-3144 |
| Help assistant | 1 | 3995-4041 |
| Generic CRUD loop | — | 3553-3600 |

---

## ESTRUCTURA PROPUESTA

```
routes/
  auth.js          → /auth/*, /api/auth/*, /api/user/*, Google OAuth
  students.js      → /api/students*, /api/student-detail, /api/admin/students*
  teachers.js      → /api/teachers*, /api/admin/teachers*, /api/teacher/*
  sessions.js      → /api/sessions*
  payments.js      → /api/payments*, /api/teacher-payments*
  exams.js         → /api/exams*, /api/simulator/results*
  calendar.js      → /api/calendar/*
  chat.js          → /api/chat/*
  transcripts.js   → /api/transcripts/*, /api/gmail/*
  ai.js            → /api/ai-tutor/*, /api/ai/*, /api/exam-simulator/*, /api/help-assistant/*
  notifications.js → /api/notifications*
  reports.js       → /api/generate-report, /api/reports/*
  settings.js      → /api/settings*, /api/academy/*, /api/onboarding/*

middleware/
  auth.js          → authenticateJWT
  roles.js         → requireRole, requireAdmin, requireTeacher, requireStudent, requireTeacherOrAdmin

services/
  email.js         → sendWelcomeEmail, sendJoinWelcomeEmail (Resend)
  calendar.js      → makeOAuth2Client, createCalendarEvent, deleteCalendarEvent
  gmail.js         → checkAndProcessTranscripts
  groq.js          → groqClient singleton
  risk.js          → checkStudentRisk, notifyAtRisk
  rooms.js         → ensureAcademyRooms, createDirectRoomIfNotExists, ensureAllChatRooms

sockets/
  chat.js          → io.on('connection') — sendMessage, typing, disconnect

utils/
  multer.js        → pdfUpload, upload, chatUpload (3 instancias)
  codes.js         → generateCode, generateUserCode
```

### index.js después del refactor (~80 líneas)
Solo contendrá:
- Imports
- Setup de express, http server, socket.io
- Aplicar middleware global
- Montar routers (`app.use('/api/auth', authRoutes)`)
- Inicializar sockets
- Server listen + initCrons + setInterval timers

---

## DEPENDENCIAS CRÍTICAS A RESOLVER

1. **`io` (Socket.io)** — se usa en rutas de chat, transcripts, reports → inyectar via `router(io)` factory
2. **`isPostgres`** — repetido 15+ veces en index.js → centralizar en `db.js` como `db.isPostgres`
3. **`groqClient`** — singleton, importar desde `services/groq.js`
4. **`createNotification`** — ya existe en `notifications.js`, importar en cada ruta que lo use
5. **Multer** — 3 instancias distintas (pdfUpload, upload, chatUpload) → consolidar en `utils/multer.js`
6. **Google OAuth2Client** — `makeOAuth2Client()` usada en 5+ lugares → exportar desde `services/calendar.js`

---

## PLAN DE IMPLEMENTACIÓN (fases)

### Fase 1 — Infraestructura (sin tocar rutas) ✅ COMPLETE (64/64 smoke tests)
- [x] Crear `middleware/auth.js` → extraer `authenticateJWT`
- [x] Crear `middleware/roles.js` → extraer `requireRole`, `requireAdmin`, etc.
- [x] Crear `services/groq.js` → exportar `groqClient` singleton
- [x] Crear `services/email.js` → extraer `sendWelcomeEmail`, `sendJoinWelcomeEmail`
- [x] Crear `services/calendar.js` → extraer `makeOAuth2Client`, `createCalendarEvent`, `deleteCalendarEvent`
- [x] Crear `services/gmail.js` → extraer `checkAndProcessTranscripts`
- [x] Crear `services/risk.js` → extraer `checkStudentRisk`, `notifyAtRisk`
- [x] Crear `services/rooms.js` → extraer `ensureAcademyRooms`, `createDirectRoomIfNotExists`, `ensureAllChatRooms`
- [x] Crear `utils/multer.js` → consolidar 3 instancias multer
- [x] Crear `utils/codes.js` → extraer `generateCode`, `generateUserCode`
- [x] Añadir `db.isPostgres` a `db.js`
- [x] Limpiar index.js: eliminar todos los cuerpos inline duplicados

### Fase 2 — Routers (uno por uno, verificar tras cada uno)
- [x] `routes/notifications.js` ✅ 64/64
- [x] `routes/settings.js` ✅ 64/64
- [x] `routes/reports.js` ✅ 64/64
- [x] `routes/ai.js` ✅ 64/64
- [x] `routes/transcripts.js` ✅ 64/64
- [x] `routes/calendar.js` ✅ 64/64
- [ ] `routes/auth.js` → auth routes + Google OAuth
- [ ] `routes/students.js`
- [ ] `routes/teachers.js`
- [ ] `routes/sessions.js`
- [ ] `routes/payments.js`
- [ ] `routes/exams.js`
- [ ] `routes/chat.js`

### Fase 3 — Sockets
- [ ] `sockets/chat.js` → extraer `io.on('connection')` handler completo

### Fase 4 — Limpiar index.js
- [ ] Eliminar todo lo extraído
- [ ] Montar todos los routers
- [ ] Verificar servidor arranca y tests pasan

---

## RIESGOS A VIGILAR

1. **Orden de rutas** — el genérico CRUD forEach (línea 3561) DEBE montarse DESPUÉS de las rutas específicas de exams/sessions/payments
2. **`io` injection** — los routers que emiten a sockets necesitan recibir `io` como parámetro
3. **`isPostgres` scattered** — hay condiciones SQLite/Postgres en varios routers; centralizar antes de extraer
4. **Passport session** — la estrategia Google necesita estar en el mismo contexto que el middleware de session
5. **Static files** — el orden de `express.static` y `/uploads/:folder/:filename` debe preservarse exactamente

---

## VERIFICACIÓN (por cada fase)
- Servidor arranca sin errores
- Login funciona
- Una ruta de cada categoría responde 200
- Socket.io conecta
- No hay console.error inesperados

---

*Generado: 2026-03-27 | Pendiente de aprobación antes de implementar*
