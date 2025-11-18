const router = require("express").Router();
const auth = require("../middlewares/auth");
const rbac = require("../middlewares/rbac");
const validate = require("../middlewares/validate");
const projectCtrl = require("../controllers/project.controller");
const Project = require('../models/Project.model');
const {
  createProject,
  updateProject,
  listQuery,
} = require("../helpers/project.schema");

router.get('/', async (req, res, next) => {
  try {
    const items = await Project.find().select('name').populate("name").limit(100);
    res.json({ success: true, data: items });

  } catch (err) { next(err); }
});


router.use(auth());
router.get(
  "/",
  (req, res, next) => {
    const { error, value } = listQuery.validate(req.query, {
      abortEarly: false,
    });
    if (error)
      return res
        .status(400)
        .json({ success: false, errors: error.details.map((d) => d.message) });
    req.query = value;
    next();
  },
  projectCtrl.list
);

// create (admin or superadmin only)
router.post("/", rbac("admin"), validate(createProject), projectCtrl.create);

router.get('/:id/members', projectCtrl.getMembers);
// read one (visible to member/manager/owner/admin/superadmin)
router.get("/:id", projectCtrl.getOne);

// update (owner admin or superadmin)
router.put("/:id", rbac("employee"), validate(updateProject), projectCtrl.update);

// delete (owner admin or superadmin)
router.delete("/:id", rbac("employee"), projectCtrl.remove);

// ✅ Managers
router.put('/:id/managers/add', projectCtrl.addManagers);
router.put('/:id/managers/remove',projectCtrl.removeManagers);

// ✅ Members
router.put('/:id/members/add',projectCtrl.addMembers);
router.put('/:id/members/remove',projectCtrl.removeMembers);

module.exports = router;

