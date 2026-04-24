'use strict';

const Sentry = require('@sentry/node');

/**
 * Centralized Express error handler.
 * Mount LAST via app.use(errorHandler).
 *
 * Controllers use next(err) to delegate here instead of leaking err.message
 * directly to the response. In development the full message/stack is returned
 * for ergonomics; in production we return a generic body and rely on Sentry
 * for internal diagnostics.
 */
module.exports = function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);

    const status = err.status || err.statusCode || 500;
    const isProd = process.env.NODE_ENV === 'production';

    console.error(`[ERROR] ${req.method} ${req.originalUrl} →`, err.message);
    if (err.stack && !isProd) console.error(err.stack);
    Sentry.captureException(err);

    // Below 500 or explicitly marked expose:true → safe to surface message
    const safeToExpose = status < 500 || err.expose === true;
    const body = safeToExpose
        ? { error: err.message || 'Request failed' }
        : (isProd
            ? { error: 'Internal server error' }
            : { error: err.message, stack: err.stack });

    res.status(status).json(body);
};
