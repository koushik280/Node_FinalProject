const router = require("express").Router();
const auth = require("../middlewares/auth");
const rbac = require("../middlewares/rbac");
const validate = require("../middlewares/validate");
const task = require("../helpers/task.schema");
const taskCtrl = require("../controllers/task.controller");

router.use(auth());
// Create task (Admin, SA, Manager) in a project
router.post(
  "/",
  rbac("manager"),
  validate(task.createTaskBody),
  taskCtrl.createTask
);

// My tasks (for current user)
router.get('/my',
  taskCtrl.myTasks
);

router.get('/:id',
  validate(task.taskIdParam, 'params'),
  taskCtrl.getTaskById
);
// Assign task to a project member (Admin, SA, Manager)
router.put(
  "/:id/assign",
  rbac("manager"),
  validate(task.taskIdParam, "params"),
  validate(task.assignBody),
  taskCtrl.assignTask
);


// Update task status (Assignee can update own; Admin/SA/Manager can update any in project)
router.put(
  "/:id/status",
  auth(),
  validate(task.taskIdParam, "params"),
  validate(task.statusBody),
  taskCtrl.updateStatus
);

// Update task fields (title/desc/priority/due) by creator, Admin/SA/Manager
router.put('/:id',
  validate(task.taskIdParam, 'params'),
  validate(task.updateTaskBody),
  taskCtrl.updateTask
);
// Delete task (Admin/SA/Manager for that project, or creator)
router.delete('/:id',
  validate(task.taskIdParam, 'params'),
  taskCtrl.deleteTask
);

// List tasks by project (visible to project members, manager, owner, SA)
router.get('/project/:id',
  validate(task.projectIdParam, 'params'),
  taskCtrl.listByProject
);





module.exports = router;