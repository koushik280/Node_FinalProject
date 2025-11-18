const router = require('express').Router();
const auth = require('../middlewares/auth');

// Simple allow helper (expects req.user.role = name string)
const allow = (...roles) => (req, res, next) => {
  const role = req.user?.role;
  return roles.includes(role) ? next() :
    res.status(403).json({ success:false, message:'Forbidden' });
};

const analyticsCtrl = require('../controllers/analytics.controller');

// superadmin, admin, manager can view dashboard
router.get('/summary', auth(), analyticsCtrl.summary);

module.exports = router;
