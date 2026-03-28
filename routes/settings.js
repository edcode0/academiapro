'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticateJWT }                        = require('../middleware/auth');
const { requireAdmin }                           = require('../middleware/roles');

const isPostgres = db.isPostgres;

// GET /api/academy/info
router.get('/academy/info', authenticateJWT, (req, res) => {
    db.query('SELECT name FROM academies WHERE id = $1', [req.user.academy_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result?.rows[0] || {});
    });
});

// GET /api/academy/codes
router.get('/academy/codes', authenticateJWT, requireAdmin, (req, res) => {
    db.query('SELECT teacher_code, student_code FROM academies WHERE id = $1', [req.user.academy_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result?.rows[0]);
    });
});

// POST /api/academy/regenerate
router.post('/academy/regenerate', authenticateJWT, requireAdmin, (req, res) => {
    return res.status(403).json({ error: 'Los códigos de academia son permanentes y no se pueden regenerar.' });
});

// Settings API — all keys stored as "{academy_id}_{key}" for multi-tenancy isolation
// GET /api/settings
router.get('/settings', authenticateJWT, requireAdmin, async (req, res) => {
    try {
        const prefix = `${req.user.academy_id}_`;
        const result = await db.query(
            "SELECT key, value FROM settings WHERE key LIKE $1",
            [prefix + '%']
        );
        const settings = {};
        (result.rows || []).forEach(r => {
            settings[r.key.slice(prefix.length)] = r.value;
        });
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/settings
router.post('/settings', authenticateJWT, requireAdmin, async (req, res) => {
    const settings = req.body;
    const academyId = req.user.academy_id;
    try {
        for (const [key, val] of Object.entries(settings)) {
            const prefixedKey = `${academyId}_${key}`;
            const sql = isPostgres
                ? "INSERT INTO settings (key, value, academy_id) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
                : "INSERT OR REPLACE INTO settings (key, value, academy_id) VALUES ($1, $2, $3)";
            await db.query(sql, [prefixedKey, String(val), academyId]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
