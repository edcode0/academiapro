# tasks/todo.md - Estado actual (verificado 2026-04-24)

---

## SPRINT 2026-03-25 - 4 Features ✅ COMPLETO

| Feature | Estado |
|---------|--------|
| SA1 - Group Sessions | ✅ |
| SA2 - Group Hourly Rate per Teacher | ✅ |
| SA3 - Fixed Academy Codes | ✅ |
| SA4 - Help Assistant Floating Button | ✅ |

---

## FRONTEND IMPROVEMENTS - Estado real (2026-04-23)

| # | Mejora | Estado |
|---|--------|--------|
| #1 | Mobile hamburger menu | ✅ - `hamburger-btn` + `toggleMobileNav` en 24 paginas |
| #3 | Replace `alert()` with toasts | ✅ - `showToast` en `global.js`, 0 `alert()` en HTML |
| #4 | Shared CSS deduplication | ✅ - `public/shared-dashboard.css` existe y esta enlazado |
| #5 | Empty states for tables | ✅ - ya implementado en `index.html` y `teacher_dashboard.html` |
| #6 | Password show/hide toggle | ✅ - `togglePwd()` en `login.html` y `join.html` |
| #7 | Sidebar user avatar | ✅ - CSS anadido a `shared-dashboard.css`; JS ya estaba en `global.js` |
| #8 | Student grade progress bar | ✅ - ya implementado en `student_portal.html` |
| #9 | Landing pricing + footer | ⚠️ - pricing ✅, footer existe pero es de 2 columnas (no 3) |
| #10 | Keyboard focus rings | ✅ - `:focus-visible` anadido a `shared-dashboard.css` |

### Pendiente opcional: #9 footer 3 columnas

---

## REFACTOR index.js ✅ COMPLETO (2026-04-22)

- `index.js`: 473 lineas (de 4129 originales)
- 13 routers extraidos + `sockets/chat.js` + `middleware/` + `services/` + `utils/`
- Smoke tests: 56/64 pasan (8 fallan por Groq restringido en test env - es normal)

---

## AUDITORIA DE SEGURIDAD ✅ COMPLETA (2026-04-23)

| Nivel | Fixes | Commits |
|-------|-------|---------|
| P0 - Auth bypass & cross-tenant leaks | ✅ 8 fixes | `ba01e66` |
| P1 - Data leaks & auth logic | ✅ 10 fixes | `0e06a4a` |
| P2/P3 - Rate limits, file handling, API logic | ✅ 10 fixes | `67e5807` |

Archivos modificados: `routes/auth.js`, `routes/exams.js`, `routes/sessions.js`, `routes/teachers.js`, `routes/students.js`, `routes/chat.js`, `routes/transcripts.js`, `routes/calendar.js`, `routes/reports.js`, `routes/ai.js`, `middleware/auth.js`, `middleware/roles.js`, `utils/multer.js`, `public/auth-success.html`, `public/join.html`, `public/login.html`

---

## AUDITORIA CODEX 2026-04-24 - En progreso

Plan 5 fases tras auditoria estatica de Codex. Todos los hallazgos verificados contra codigo real.

| Fase | Scope | Estado |
|------|-------|--------|
| 1 - P0/P1 authz gaps | `sockets/chat.js` (room bypass), `routes/sessions.js` (DELETE teacher filter), `routes/calendar.js` (DELETE+PUT) | ✅ `711aa67` |
| 2 - Config hardening | `SESSION_SECRET` fail-fast, cookie `httpOnly/secure/sameSite`, `trust proxy` | ✅ |
| 3 - Schema bugs | `auth.js` (quitar `subscription_status`), `teachers.js` (mark-paid columnas), `chat.js` (ruta legacy `receiver_id`) | ✅ `69869eb` |
| 4 - Error sanitization | Middleware central, migrar ~125 `err.message -> next(err)` | ✅ `0d0f2f2` |
| 5 - Verificacion dirigida | Tests smoke para cada hallazgo + arreglar runner JWT->cookies | ✅ `5875e13` + `fb6b51c` |

## DEUDA - Smoke tests rotos desde commit JWT->cookies (`51fea5b`) [PARA CODEX]

### Contexto
El commit `51fea5b` migro el login de devolver JWT en el body a setear cookie httpOnly `token`. El runner `tests/smoke.js` quedo asumiendo `r.body.token`, que ahora siempre es `null`. Resultado: gran parte de los checks autenticados fallan con `401` porque las llamadas van sin cookie.

### Evidencia
- Los endpoints de login/join en `routes/auth.js` hacen `res.cookie('token', ...)` y no devuelven `token` en JSON.
- `middleware/auth.js` lee `req.cookies.token`.
- `tests/smoke.js` sigue usando `Authorization: Bearer ...` y extrayendo `r.body?.token`.

### Fix requerido
1. En el helper `request`, aceptar `cookie` y devolver `setCookie`.
2. Tras login/join, parsear `set-cookie` y guardar `token=...`.
3. Renombrar variables `*Token -> *Cookie` y pasar `{ cookie }` en todas las llamadas autenticadas.
4. Actualizar labels y asserts para reflejar autenticacion por cookie.

### Cobertura adicional 2026-04-24
1. Alinear la asercion de portal-data con la respuesta real (`averageScore` top-level).
2. Anadir un test separado de websocket authz con `socket.io-client` para validar que un no-miembro no puede unirse a salas ajenas ni recibir eventos.
3. Exponer script npm dedicado para el test websocket.

### Criterio de exito
- `npm run test:smoke` -> >=56/64 (baseline anterior). Los 8 restantes por Groq restringido en test env siguen siendo esperados.
- El test websocket debe fallar si un no-miembro recibe `new_message` de una sala ajena.
- No tocar el servidor ni el middleware para arreglar el runner; solo tests y scripts.

---

## BUG FIXES 2026-03-28 ✅ COMPLETO

- BUG 1 - `db-group-students-container` ya usaba `'block'` (ya estaba corregido)
- BUG 2 - `group_hourly_rate` y `saveTeacherRate()` ya implementados en `settings.html`
