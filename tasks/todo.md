# Session Plan — 2026-03-28 (Frontend Improvements)

## 9 Frontend Improvements — Sequential

### #1 Mobile hamburger menu
- [ ] Add shared CSS + JS to glassmorphism.css / global.js
- [ ] Add hamburger button + overlay markup to all 24 dashboard HTML pages

### #3 Replace alert() with toasts
- [ ] Add showToast(msg, type) to global.js (success/error/info)
- [ ] Replace all alert() calls in all HTML files (login.html uses inline banner)

### #4 Shared CSS deduplication
- [ ] Create public/shared-dashboard.css with common blocks
- [ ] Link in all dashboard pages
- [ ] Remove duplicated blocks from individual files

### #5 Empty states for tables
- [ ] index.html: student table + activity list empty states
- [ ] teacher_dashboard.html: student table empty state

### #6 Password show/hide toggle
- [ ] login.html: add eye icon to password field
- [ ] join.html: add eye icon to password field

### #7 Sidebar user avatar
- [ ] Add avatar CSS to shared-dashboard.css
- [ ] Add avatar HTML to all dashboard pages

### #8 Student grade progress bar
- [ ] Add progress bar CSS + HTML to student_portal.html

### #9 Landing pricing + footer
- [ ] Add pricing section to landing.html
- [ ] Expand footer to 3 columns

### #10 Keyboard focus rings
- [ ] Add :focus box-shadow to shared-dashboard.css and login/join/register

## Done when:
- [ ] npm run test:smoke → 64/64
- [ ] git commit + push

---

# Session Plan — 2026-03-28 (Bug Fixes)

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

### Fase 2 — Routers integrados (archivo + mounted + inline eliminado)
- [x] `routes/calendar.js` ✅ integrado
- [x] `routes/auth.js` ✅ integrado
- [x] `routes/students.js` ✅ integrado
- [x] `routes/teachers.js` ✅ integrado
- [x] `routes/sessions.js` ✅ integrado
- [x] `routes/payments.js` ✅ integrado
- [x] `routes/exams.js` ✅ integrado
- [x] `routes/chat.js` ✅ integrado (factory `makeChatRouter(io)`)

### Fase 2.5 — Routers HUÉRFANOS (archivo existe, NO cableado en index.js, inline activo)
- [x] `routes/ai.js` ✅ — cableado, inline eliminado. Fix: academy_id filter + ownership check
- [x] `routes/notifications.js` ✅ — cableado (`/api`), inline eliminado
- [x] `routes/reports.js` ✅ — cableado (`/api`), inline eliminado
- [x] `routes/settings.js` ✅ — cableado (`/api`), inline eliminado
- [x] `routes/transcripts.js` ✅ — cableado (factory+io), inline eliminado. Fix: HMAC state signing

### Fase 3 — Sockets
- [ ] `sockets/chat.js` → extraer `io.on('connection')` handler (`index.js:1473`). `sockets/` existe pero vacío.

### Fase 4 — Limpiar index.js (pendiente tras Fase 2.5 + 3)
Código inline aún en `index.js` (1752 líneas actuales, target ~80):
- [ ] Gmail OAuth routes (L491-585) — irán a `routes/transcripts.js`
- [ ] Transcripts routes (L586-867) — irán a `routes/transcripts.js`
- [ ] AI tutor (L352-491) + AI conversations (L1148-1220) — irán a `routes/ai.js`
- [ ] Notifications (L890-927) — irán a `routes/notifications.js`
- [ ] Reports (L985, L1308-1469) — irán a `routes/reports.js`
- [ ] Settings (L1273-1305) — irán a `routes/settings.js`
- [ ] Academy/Onboarding (L1088-1145) — irán a `routes/settings.js`
- [ ] Help-assistant (L1614) — pendiente de router destino
- [ ] Generic CRUD forEach loop (L1231-1270)
- [ ] `checkStudentRisk`/`notifyAtRisk` inline duplicados (L929, L958) — `services/risk.js` ya existe
- [ ] `ensureAcademyRooms`/`createDirectRoomIfNotExists`/`ensureAllChatRooms` inline duplicados (L1002, L1565, L1580) — `services/rooms.js` ya existe
- [ ] Socket.io connection handler (L1473) — mover a `sockets/chat.js`

---

## Estado verificado 2026-04-21
- `index.js`: 1752 líneas (de 4129 originales, target ~80)
- Routers integrados: 8/13
- Infraestructura (Fase 1) completa: middleware/, services/, utils/, db.isPostgres ✅

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
