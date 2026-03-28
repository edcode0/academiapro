'use strict';

const requireRole = (role) => (req, res, next) => {
    if (req.user && req.user.role === role) next();
    else res.status(403).send('Forbidden');
};

const requireAdmin          = requireRole('admin');
const requireTeacher        = requireRole('teacher');
const requireStudent        = requireRole('student');

const requireTeacherOrAdmin = (req, res, next) => {
    if (req.user && (req.user.role === 'teacher' || req.user.role === 'admin')) next();
    else res.status(403).send('Forbidden');
};

module.exports = { requireRole, requireAdmin, requireTeacher, requireStudent, requireTeacherOrAdmin };
