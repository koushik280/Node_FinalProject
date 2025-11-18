const Task = require("../models/Task.model");
const Project = require("../models/Project.model");
const User = require("../models/User.model");
const ActivityLog = require("../models/ActivityLog.model");
const { emitToProject, emitToUser } = require("../helpers/socket");

function isSA(req) {
  return req.user.role === "superadmin";
}
function isAdmin(req) {
  return req.user.role === "admin";
}
function isManager(req) {
  return req.user.role === "manager";
}
function isElevated(req) {
  return isSA(req) || isAdmin(req) || isManager(req);
}

// Check if user is project owner/admin or SA
function isOwnerOrSA(req, project) {
  if (isSA(req)) return true;
  return String(project.owner) === String(req.user.id);
}

// Check membership helpers
function isProjectManager(project, userId) {
  return project.managers?.some((id) => String(id) === String(userId));
}
function isProjectMember(project, userId) {
  return project.members?.some((id) => String(id) === String(userId));
}
function canManageProject(req, project) {
  if (isSA(req) || isAdmin(req)) return true;
  if (String(project.owner) === String(req.user.id)) return true;
  if (isProjectManager(project, req.user.id)) return true;
  return false;
}
class TaskController {
  async createTask(req, res, next) {
    try {
      const { title, description, projectId, priority, dueDate } = req.body;
      const project = await Project.findById(projectId);
      if (!project)
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });
      // Only SA, project owner (admin), or a listed manager can create tasks
      if (!canManageProject(req, project)) {
        return res.status(403).json({
          success: false,
          message: "Not allowed to create tasks for this project",
        });
      }
      const task = await Task.create({
        title,
        description,
        projectId,
        priority,
        dueDate: dueDate || null,
        createdBy: req.user.id,
      });

      res
        .status(201)
        .json({ success: true, message: "Task created", data: task });
    } catch (err) {
      next(err);
    }
  }

  async assignTask(req, res, next) {
    try {
      const task = await Task.findById(req.params.id);
      if (!task)
        return res
          .status(404)
          .json({ success: false, message: "Task not found" });

      const project = await Project.findById(task.projectId);
      if (!project)
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });

      if (!canManageProject(req, project)) {
        return res.status(403).json({
          success: false,
          message: "Not allowed to assign in this project",
        });
      }

      const assignee = await User.findById(req.body.userId).populate(
        "role",
        "name"
      );
      if (!assignee)
        return res
          .status(404)
          .json({ success: false, message: "Assignee not found" });

      const role = assignee.role?.name;
      if (!["manager", "employee"].includes(role)) {
        return res.status(400).json({
          success: false,
          message: "Assignee must be a manager or employee",
        });
      }

      const validMember =
        isProjectManager(project, assignee._id) ||
        isProjectMember(project, assignee._id);
      if (!validMember) {
        return res.status(400).json({
          success: false,
          message: "Assignee is not part of this project",
        });
      }

      task.assignedTo = assignee._id;

      // ✅ Reset status if already progressed
      const done = (task.status || "").toLowerCase();
      if (done === "completed" || done === "in progress") {
        task.status = "Pending";
      }

      await task.save(); // <-- ✅ SAVE FIRST

      // ✅ 1) Activity Log
      await ActivityLog.create({
        userId: req.user.id,
        action: "task.assigned",
        entity: "Task",
        entityId: task._id,
        projectId: task.projectId,
        metadata: { to: String(assignee._id), title: task.title },
      });

      // ✅ 2) Emit real-time event
      emitToProject(req.app, task.projectId, "task:assigned", {
        taskId: String(task._id),
        projectId: String(task.projectId),
        assignee: {
          id: String(assignee._id),
          name: assignee.name,
          role: assignee.role?.name,
        },
        title: task.title,
        at: new Date().toISOString(),
      });

      // also ping the assignee personally
      emitToUser(req.app, assignee._id, "task:assigned_to_you", {
        taskId: String(task._id),
        projectId: String(task.projectId),
        title: task.title,
      });

      res.json({ success: true, message: "Task assigned", data: task });
    } catch (err) {
      next(err);
    }
  }

  // async updateStatus(req, res, next) {
  //   try {
  //     const task = await Task.findById(req.params.id);
  //     if (!task) {
  //       return res
  //         .status(404)
  //         .json({ success: false, message: "Task not found" });
  //     }

  //     const project = await Project.findById(task.projectId);
  //     if (!project) {
  //       return res
  //         .status(404)
  //         .json({ success: false, message: "Project not found" });
  //     }

  //     const isAssignee =
  //       task.assignedTo && String(task.assignedTo) === String(req.user.id);
  //     if (!(isAssignee || canManageProject(req, project))) {
  //       return res
  //         .status(403)
  //         .json({ success: false, message: "Not allowed to update status" });
  //     }

  //     // --- Normalize incoming status to schema's canonical values ---
  //     const CANON = {
  //       pending: "Pending",
  //       "in progress": "In Progress",
  //       in_progress: "In Progress",
  //       completed: "Completed",
  //       // already-canonical passthroughs:
  //       Pending: "Pending",
  //       "In Progress": "In Progress",
  //       Completed: "Completed",
  //     };

  //     const raw = String(req.body.status ?? "").trim();
  //     // handle case-insensitive + underscores/multiple spaces
  //     const key = raw
  //       .toLowerCase()
  //       .replace(/_/g, " ")
  //       .replace(/\s+/g, " ")
  //       .trim();
  //     const nextVal = CANON[raw] || CANON[key];

  //     if (!nextVal) {
  //       return res
  //         .status(400)
  //         .json({ success: false, message: "Invalid status" });
  //     }

  //     const oldStatus = task.status;

  //     if (task.status === nextVal) {
  //       return res.json({
  //         success: true,
  //         message: "Status unchanged",
  //         data: task,
  //       });
  //     }

  //     task.status = nextVal;
  //     await task.save();

  //     await ActivityLog.create({
  //       userId: req.user.id,
  //       action: "task.status_changed",
  //       entity: "Task",
  //       entityId: task._id,
  //       projectId: task.projectId,
  //       metadata: { from: oldStatus, to: nextVal, title: task.title },
  //     });

  //     emitToProject(req.app, task.projectId, "task:status_changed", {
  //       taskId: String(task._id),
  //       projectId: String(task.projectId),
  //       title: task.title,
  //       status: nextVal,
  //       by: String(req.user.id),
  //       at: new Date().toISOString(),
  //     });

  //     // optional: notify assignee personally too
  //     if (task.assignedTo) {
  //       emitToUser(req.app, task.assignedTo, "task:your_task_status_changed", {
  //         taskId: String(task._id),
  //         projectId: String(task.projectId),
  //         title: task.title,
  //         status: nextVal,
  //       });
  //     }
  //     return res.json({ success: true, message: "Status updated", data: task });
  //   } catch (err) {
  //     return next(err);
  //   }
  // }

  async updateStatus(req, res, next) {
    try {
      const task = await Task.findById(req.params.id);
      if (!task) {
        return res
          .status(404)
          .json({ success: false, message: "Task not found" });
      }

      const project = await Project.findById(task.projectId);
      if (!project) {
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });
      }

      // --- UPGRADED AUTHORIZATION LOGIC START ---

      // 1. Check if the user is the Assignee (always allowed)
      const isAssignee =
        task.assignedTo && String(task.assignedTo) === String(req.user.id);

      // 2. Check if the user is a SuperAdmin or Admin (These are RESTRICTED from updating status)
      const isHighLevelAdmin = isSA(req) || isAdmin(req);

      // 3. Check if the user is a Project Manager or Project Owner
      const isManagerOrOwner =
        isProjectManager(project, req.user.id) ||
        String(project.owner) === String(req.user.id);

      let isAuthorizedToUpdate = false;

      if (isAssignee) {
        isAuthorizedToUpdate = true; // Assignee can always update
      } else if (isManagerOrOwner) {
        // Project Manager/Owner can update ONLY IF they are NOT a SuperAdmin/Admin
        if (!isHighLevelAdmin) {
          isAuthorizedToUpdate = true;
        }
      }

      if (!isAuthorizedToUpdate) {
        // This denial now captures unauthorized users AND the explicitly restricted high-level admins.
        return res
          .status(403)
          .json({ success: false, message: "Not allowed to update status" });
      }

      // --- UPGRADED AUTHORIZATION LOGIC END ---

      // --- Normalize incoming status to schema's canonical values ---
      const CANON = {
        pending: "Pending",
        "in progress": "In Progress",
        in_progress: "In Progress",
        completed: "Completed",
        // already-canonical passthroughs:
        Pending: "Pending",
        "In Progress": "In Progress",
        Completed: "Completed",
      };

      const raw = String(req.body.status ?? "").trim();
      const key = raw
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const nextVal = CANON[raw] || CANON[key];

      if (!nextVal) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid status" });
      }

      const oldStatus = task.status;

      if (task.status === nextVal) {
        return res.json({
          success: true,
          message: "Status unchanged",
          data: task,
        });
      }

      task.status = nextVal;
      await task.save();

      // Activity Log and Socket Emissions
      await ActivityLog.create({
        userId: req.user.id,
        action: "task.status_changed",
        entity: "Task",
        entityId: task._id,
        projectId: task.projectId,
        metadata: { from: oldStatus, to: nextVal, title: task.title },
      });

      emitToProject(req.app, task.projectId, "task:status_changed", {
        taskId: String(task._id),
        projectId: String(task.projectId),
        title: task.title,
        status: nextVal,
        by: String(req.user.id),
        at: new Date().toISOString(),
      });

      // optional: notify assignee personally too
      if (task.assignedTo) {
        emitToUser(req.app, task.assignedTo, "task:your_task_status_changed", {
          taskId: String(task._id),
          projectId: String(task.projectId),
          title: task.title,
          status: nextVal,
        });
      }
      return res.json({ success: true, message: "Status updated", data: task });
    } catch (err) {
      return next(err);
    }
  }

  async updateTask(req, res, next) {
    try {
      const task = await Task.findById(req.params.id);
      if (!task)
        return res
          .status(404)
          .json({ success: false, message: "Task not found" });

      const project = await Project.findById(task.projectId);
      if (!project)
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });

      const isCreator = String(task.createdBy) === String(req.user.id);
      if (!(isCreator || canManageProject(req, project))) {
        return res
          .status(403)
          .json({ success: false, message: "Not allowed to update task" });
      }

      const { title, description, priority, dueDate } = req.body;
      if (title !== undefined) task.title = title;
      if (description !== undefined) task.description = description;
      if (priority !== undefined) task.priority = priority;
      if (dueDate !== undefined) task.dueDate = dueDate || null;

      await task.save();
      res.json({ success: true, message: "Task updated", data: task });
    } catch (e) {
      next(e);
    }
  }

  async deleteTask(req, res, next) {
    try {
      const task = await Task.findById(req.params.id);
      if (!task)
        return res
          .status(404)
          .json({ success: false, message: "Task not found" });

      const project = await Project.findById(task.projectId);
      if (!project)
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });

      const isCreator = String(task.createdBy) === String(req.user.id);
      if (!(isCreator || canManageProject(req, project))) {
        return res
          .status(403)
          .json({ success: false, message: "Not allowed to delete task" });
      }

      await Task.deleteOne({ _id: task._id });
      res.json({ success: true, message: "Task deleted" });
    } catch (e) {
      next(e);
    }
  }

  async listByProject(req, res, next) {
    try {
      const project = await Project.findById(req.params.id);
      if (!project)
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });

      // Visibility: SA sees all; owner admin; project managers & members
      const canSee =
        isSA(req) ||
        isOwnerOrSA(req, project) ||
        isProjectManager(project, req.user.id) ||
        isProjectMember(project, req.user.id);
      if (!canSee)
        return res.status(403).json({
          success: false,
          message: "Not allowed to view tasks for this project",
        });

      const tasks = await Task.find({ projectId: project._id }).sort({
        createdAt: -1,
      });
      res.json({ success: true, data: { projectId: project._id, tasks } });
    } catch (e) {
      next(e);
    }
  }

  async myTasks(req, res, next) {
    try {
      const tasks = await Task.find({ assignedTo: req.user.id })
        .sort({ dueDate: 1, createdAt: -1 })
        .populate({ path: "projectId", select: "name" });

      res.json({
        success: true,
        data: tasks.map((t) => ({
          ...t.toObject(),
          projectName: t.projectId?.name,
          projectId: t.projectId?._id || t.projectId,
        })),
      });
    } catch (e) {
      next(e);
    }
  }

  async getTaskById(req, res, next) {
    try {
      // 1️⃣ Fetch task and populate references
      const task = await Task.findById(req.params.id)
        .populate("assignedTo", "name email")
        .populate("projectId", "name")
        .populate("createdBy", "name email")
        .populate({ path: "comments.by", select: "name email" });

      if (!task) {
        return res
          .status(404)
          .json({ success: false, message: "Task not found" });
      }

      // 2️⃣ Ensure project exists
      const project = task.projectId?.name
        ? task.projectId
        : await Project.findById(task.projectId);

      if (!project) {
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });
      }

      // 3️⃣ Check user permission
      const userId = String(req.user?.id || "");
      const assignedTo = String(task.assignedTo?._id || task.assignedTo);

      const canView =
        isSA(req) ||
        isOwnerOrSA(req, project) ||
        isProjectManager(project, userId) ||
        isProjectMember(project, userId) ||
        assignedTo === userId;

      if (!canView) {
        return res.status(403).json({
          success: false,
          message: "Access denied: you’re not allowed to view this task.",
        });
      }

      // 4️⃣ Prepare simplified task data for response
      const data = {
        id: task._id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        createdAt: task.createdAt,
        assignedTo: task.assignedTo,
        createdBy: task.createdBy,
        project: {
          id: project._id,
          name: project.name,
        },
      };

      // 5️⃣ Send success response
      return res.json({ success: true, data });
    } catch (error) {
      console.error("getTaskById error:", error);
      next(error);
    }
  }
}

module.exports = new TaskController();
