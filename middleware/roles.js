'use strict';

const requireRole = (role) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === role) return next();
    res.status(403).json({ error: 'Forbidden' });
};

const requireAdmin          = requireRole('admin');
const requireTeacher        = requireRole('teacher');
const requireStudent        = requireRole('student');

const requireTeacherOrAdmin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === 'teacher' || req.user.role === 'admin') return next();
    res.status(403).json({ error: 'Forbidden' });
};

module.exports = { requireRole, requireAdmin, requireTeacher, requireStudent, requireTeacherOrAdmin };
