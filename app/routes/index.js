const router = require('express').Router();
router.use('/auth', require('./auth.routes'));
const auth = require('../middlewares/auth');
router.use('/users', require('./user.routes'));
router.use('/projects', require('./project.routes'));
router.use("/tasks",require("./task.routes"))
router.use("/analytics",require("./analytics.routes"))
router.use("/activity",require("./activity.routes"))
router.use("/tasks",require("./task.extra.routes"))


router.get('/protected', auth(), (req, res) => {
  res.json({ success: true, message: `Welcome ${req.user.role}!Authorized ✅` });
});
module.exports = router;
