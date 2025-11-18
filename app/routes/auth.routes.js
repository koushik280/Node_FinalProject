const router = require("express").Router();
const authCtrl = require("../controllers/auth.controller");
const validate = require("../middlewares/validate");
const {
  registerSchema,
  verifySchema,
  loginSchema,
  changePwdSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require("../helpers/auth.schema");
const authMw = require("../middlewares/auth");

router.post("/register", validate(registerSchema), authCtrl.signup);
router.post("/verify", validate(verifySchema), authCtrl.verify);
router.post("/login", validate(loginSchema), authCtrl.login);
router.put(
  "/change-password",
  authMw(),
  validate(changePwdSchema),
  authCtrl.changePassword
);
router.post("/refresh", authCtrl.refresh);
router.post("/logout", authCtrl.logout);

router.post(
  "/forgot-password",
  validate(forgotPasswordSchema),
  authCtrl.forgotPassword
);
router.post(
  "/reset-password",
  validate(resetPasswordSchema),
  authCtrl.resetPassword
);

module.exports = router;
