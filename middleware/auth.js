'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('[FATAL] JWT_SECRET environment variable is not set');
    process.exit(1);
}

const authenticateJWT = (req, res, next) => {
    const token = req.cookies.token;

    if (token) {
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) {
                if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
                return res.redirect('/login');
            }
            req.user = user;
            next();
        });
    } else {
        if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
        res.redirect('/login');
    }
};

module.exports = { authenticateJWT, JWT_SECRET };
