const router = require('express').Router();
const auth = require('../middlewares/auth');
const ctl = require('../controllers/activity.controller');

router.get('/recent', auth(), ctl.recent);
module.exports = router;
