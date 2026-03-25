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
