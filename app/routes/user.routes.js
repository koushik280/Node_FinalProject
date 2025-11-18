const router = require("express").Router();
const auth = require("../middlewares/auth");
const rbac = require("../middlewares/rbac");
const userCtrl = require("../controllers/user.controller");
const validate = require("../middlewares/validate");
const {
  listUsersQuery,
  updateUserRoleBody,
  createUserBody
} = require("../helpers/user.schema");
const { objectIdParam }=require("../helpers/common.schema");
router.use(auth());

// list users (admin+)
router.get(
  "/",
  rbac("admin"),
  (req, res, next) => {
    // validate query manually to keep middleware simple for queries
    const { error, value } = listUsersQuery.validate(req.query, {
      abortEarly: false,
    });
    if (error)
      return res
        .status(400)
        .json({ success: false, errors: error.details.map((d) => d.message) });
    req.query = value;
    next();
  },
  userCtrl.list
);
router.get('/by-email', userCtrl.getByEmail);
router.get("/me",userCtrl.fetchMe)
// get user (admin+ or self)
router.get("/:id", rbac("admin"), userCtrl.getone);
// update role (admin+)
router.put(
  "/:id/role",
  rbac("admin"),
  validate(updateUserRoleBody),
  userCtrl.updateRole
);
router.post('/', rbac('superadmin'), validate(createUserBody), userCtrl.createBySuperAdmin);


router.delete('/:id',
  auth(),                 // JWT required
  rbac('superadmin'),     // Only Super Admin
  validate(objectIdParam, 'params'),
  userCtrl.deleteUserHard
);
module.exports = router;

