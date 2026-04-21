## SESSION START
1. Read tasks/lessons.md — apply all lessons before touching anything
2. Read tasks/todo.md — understand current state
3. If neither exists, create them before starting

## WORKFLOW

### 1. Plan First
- Enter plan mode for any non-trivial task (3+ steps)
- Write plan to tasks/todo.md before implementing
- If something goes wrong, STOP and re-plan — never push through

### 2. Subagent Strategy
- Use subagents to keep main context clean
- One task per subagent
- Throw more compute at hard problems

### 3. Self-Improvement Loop
- After any correction: update tasks/lessons.md
- Format: [date] | what went wrong | rule to prevent it
- Review lessons at every session start

### 4. Verification Standard
- Never mark complete without proving it works
- Run tests, check logs, diff behavior
- Ask: "Would a staff engineer approve this?"

### 5. Demand Elegance
- For non-trivial changes: is there a more elegant solution?
- If a fix feels hacky: rebuild it properly
- Don't over-engineer simple things

### 6. Autonomous Bug Fixing
- When given a bug: just fix it
- Go to logs, find root cause, resolve it
- No hand-holding needed

## CORE PRINCIPLES
- Simplicity First — touch minimal code
- No Laziness — root causes only, no temp fixes
- Never Assume — verify paths, APIs, variables before using
- Ask Once — one question upfront if unclear, never interrupt mid-task

## TASK MANAGEMENT
1. Plan → tasks/todo.md
2. Verify → confirm before implementing
3. Track → mark complete as you go
4. Explain — high-level summary each step
5. Learn → tasks/lessons.md after corrections

## LEARNED
(Claude fills this in over time)

---

## PROJECT CONTEXT

**AcademiaPro** — SaaS para academias de repaso. Multi-tenant (academy_id en todas las queries).

**Stack:** Node.js + Express 5 · PostgreSQL (Railway) / SQLite (local) · Socket.io · Groq (llama-3.3-70b) · Google OAuth + Calendar + Gmail · Resend email · Sentry · JWT + bcrypt

**Deploy:** `git push origin main` → Railway auto-deploy (~2 min). No hay staging.

**Test:** `npm run test:smoke` → 56/64 pasan (8 fallan por Groq restringido en test env — es normal).

**Estructura de módulos:**
```
routes/       → 13 routers (auth, students, teachers, sessions, payments, exams,
                             calendar, chat, ai, notifications, reports, settings, transcripts)
services/     → groq, email, calendar, gmail, risk, rooms
middleware/   → auth.js (authenticateJWT), roles.js (requireAdmin, requireTeacher, etc.)
utils/        → multer.js, codes.js
sockets/      → vacío (pendiente Fase 3 del refactor)
cron.js       → jobs diarios
notifications.js → createNotification + setIo
db.js         → Pool PG / SQLite wrapper + initDb() + migrations
index.js      → 872 líneas: setup, middleware global, montar routers, socket handler, intervals
```

**Roles:** admin · teacher · student. Siempre verificar `req.user.role` y `req.user.academy_id`.

**Groq en producción:** si falla, devolver 503 con mensaje amigable al usuario (no exponer e.message).

**Skills activas:** invocar `using-superpowers` al inicio de cada respuesta para verificar si aplica otra skill.

**Refactor en curso:** Fases 3 y 4 pendientes — ver `tasks/todo.md` para estado exacto.
