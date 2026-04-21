# Lessons Learned

## Format: [fecha] | qué salió mal | regla para prevenirlo

---

[2026-04-21] | El todo.md marcaba como "pendientes" 7 routers (auth, students, teachers, sessions, payments, exams, chat) que ya estaban integrados, y como "completados" 5 routers (ai, notifications, reports, settings, transcripts) que existían como archivos pero NO estaban cableados en index.js ni tenían el inline eliminado. | Antes de reportar estado del refactor: verificar con `grep "require('./routes/"` en index.js y comprobar que el inline fue eliminado — no asumir por la existencia del archivo.

[2026-04-21] | routes/transcripts.js usaba `state: req.user.id.toString()` en el OAuth de Gmail (estado simple), mientras que el código inline de index.js usaba HMAC-signed state con nonce para prevenir CSRF. Al extraer el router se perdió la seguridad. | Al extraer código inline a un router, comparar línea a línea con el original antes de dar por buena la extracción. Prestar especial atención a flujos OAuth y crypto.

[2026-04-21] | routes/ai.js tenía `GET /api/ai/conversations` sin filtro `AND academy_id = $2` — cualquier usuario podía ver conversaciones de otra academia. | En toda query de listado, siempre incluir `academy_id = $X` para aislamiento multi-tenant. Revisar sistemáticamente este filtro al extraer rutas.

[2026-04-21] | routes/ai.js tenía `GET /api/ai/conversations/:id/messages` sin ownership check — cualquier usuario autenticado podía leer mensajes de otra conversación. | En rutas que acceden a un recurso por ID, siempre añadir `AND user_id = $X` o equivalente antes de devolver datos.

[2026-04-21] | El catch genérico en routes/ai.js exponía `e.message` de Groq directamente al usuario ("Organization has been restricted..."). | Los errores de APIs externas (Groq, Resend, Google) nunca deben llegar al cliente. Usar un catch específico para la llamada externa y devolver 503 con mensaje amigable.

[2026-04-21] | El todo.md acumuló planes de sesiones de marzo mezclados con el plan de refactor activo, con números de línea obsoletos. | Separar el todo.md en secciones: "Activo" (con estado real) y "Archivo" (planes históricos). Actualizar líneas y métricas tras cada sesión de trabajo.
