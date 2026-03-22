# Session Plan — 2026-03-22

## 6-Subagent Feature Sprint

### SA1 — Google OAuth role-aware + redirect to /join
- [ ] Pass selected role as `state` param in OAuth URL (login.html)
- [ ] In Google callback: if new user + student/teacher → redirect to /join?role=&email=&google=true
- [ ] If new user + admin → create account normally
- [ ] If existing user → login normally
- [ ] In join.html: read URL params on load, pre-fill role and email

### SA2 — Academy name in all dashboards
- [ ] Fetch academy name from GET /api/settings or /api/academy/info
- [ ] Display academy-header block in index.html (admin)
- [ ] Display in teacher_dashboard.html
- [ ] Display in student_portal.html
- [ ] Style: academy-name (1.1rem, #6366f1, 600) + greeting (1.6rem, 700)

### SA3 — Fix Google Calendar/Gmail independent status
- [ ] Add calendar_access_token, calendar_refresh_token, calendar_token_expiry columns to users
- [ ] /api/calendar/connect + callback → save to calendar_* columns
- [ ] /api/gmail/status → checks gmail_access_token only
- [ ] /api/calendar/status → checks calendar_access_token only
- [ ] createCalendarEvent() → use calendar_* tokens
- [ ] Settings UI shows correct independent status

### SA4 — Fix chat duplicate message on send
- [ ] Add tempId to optimistic message on send (chat.html)
- [ ] On socket new_message: check pendingTempIds
- [ ] If match → replace temp message with real one
- [ ] If no match → append normally

### SA5 — Clickable notifications
- [ ] On notification click: mark read then navigate to link
- [ ] New session notifications → link: /student-portal/calendar?session=ID
- [ ] New message notifications → link: /chat?room=ROOM_ID
- [ ] student_portal_calendar.html: read ?session= param, auto-open modal
- [ ] chat.html: read ?room= param, auto-open that room

### SA6 — Better join CTA in login.html / join.html
- [ ] Replace small text link in login.html with styled button block
- [ ] Add "¿Eres el dueño?" section at bottom of join.html

## Status
- [ ] All subagents complete
- [ ] git add . && commit && push
