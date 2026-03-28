'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticateJWT } = require('../middleware/auth');

router.get('/notifications', authenticateJWT, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT * FROM notifications WHERE user_id = $1
             ORDER BY created_at DESC LIMIT 50`,
            [req.user.id]
        );
        res.json(result.rows || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/notifications/mark-read/:id', authenticateJWT, async (req, res) => {
    try {
        await db.query(
            `UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/notifications/mark-all-read', authenticateJWT, async (req, res) => {
    try {
        await db.query(
            `UPDATE notifications SET read = TRUE WHERE user_id = $1`,
            [req.user.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
