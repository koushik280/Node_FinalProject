const Project = require("../models/Project.model");
const User = require("../models/User.model");
const Task = require("../models/Task.model");

const mongoose = require("mongoose");

const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

function isOwnerorSA(req, project) {
  if (req.user.role === "superadmin") return true;
  return String(project.owner) === String(req.user.id);
}

async function ensureUsersExistAndRole(userIds, allowedRoles) {
  const users = await User.find({ _id: { $in: userIds } }).populate(
    "role",
    "name"
  );
  if (users.length !== userIds.length) {
    const found = new Set(users.map((u) => String(u._id)));
    const missing = userIds.filter((id) => !found.has(String(id)));
    const msg = `User(s) not found: ${missing.join(", ")}`;
    return { ok: false, msg };
  }
  if (allowedRoles) {
    const bad = users.filter((u) => !allowedRoles.includes(u.role?.name));
    if (bad.length) {
      return {
        ok: false,
        msg: `Invalid role(s) for this action: ${bad
          .map((b) => `${b.email}(${b.role?.name})`)
          .join(", ")}`,
      };
    }
  }
  return { ok: true, users };
}

class ProjectController {
  async create(req, res, next) {
    try {
      // Only admin/superadmin should reach here (rbac at route)
      const owner = req.user.id;
      const { name, description, managers = [], members = [] } = req.body;

      const doc = await Project.create({
        name,
        description,
        owner,
        managers,
        members,
      });
      res
        .status(201)
        .json({ success: true, message: "Project created", data: doc });
    } catch (err) {
      next(err);
    }
  }

  async list(req, res, next) {
    try {
      const { page = 1, limit = 10, search } = req.query;
      const filter = {};

      const role = req.user.role;
      const userId = req.user.id;

      if (role === "superadmin") {
        // optional search
        if (search) filter.name = new RegExp(search, "i");
      } else if (role === "admin") {
        filter.owner = userId;
        if (search) filter.name = new RegExp(search, "i");
      } else {
        // manager/employee: projects they are member of
        filter.$or = [{ managers: userId }, { members: userId }];
        if (search) filter.name = new RegExp(search, "i");
      }

      const [items, total] = await Promise.all([
        Project.find(filter)
          .populate("owner", "name email")
          .populate("managers", "name email")
          .populate("members", "name email")
          .skip((page - 1) * limit)
          .limit(Number(limit))
          .sort({ createdAt: -1 }),
        Project.countDocuments(filter),
      ]);

      res.json({
        success: true,
        data: {
          projects: items,
          page: Number(page),
          limit: Number(limit),
          total,
        },
      });
    } catch (err) {
      next(err);
    }
  }

 


  async getOne(req, res, next) {
    try {
      const id = req.params.id;
      if (!isObjectId(id))
        return res.status(400).json({ success: false, message: "Invalid id" });
      // In your project show controller
      const project = await Project.findById(id)
        .populate("owner", "name email")
        .populate({
          path: "managers",
          select: "name email role",
          populate: { path: "role", select: "name" },
        })
        .populate({
          path: "members",
          select: "name email role",
          populate: { path: "role", select: "name" },
        });

      if (!project)
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });
      // Visibility: owner/admin/superadmin OR member/manager
      const uid = req.user.id;
      const role = req.user.role;
      const visible =
        role === "superadmin" ||
        (project.owner && project.owner._id.equals(uid)) ||
        project.managers.some((u) => u._id.equals(uid)) ||
        project.members.some((u) => u._id.equals(uid));

      if (!visible)
        return res.status(403).json({ success: false, message: "Forbidden" });

      res.json({ success: true, data: project });
    } catch (err) {
      next(err);
    }
  }

  async update(req, res, next) {
    try {
      const id = req.params.id;
      const role = req.user.role;
      const uid = req.user.id;

      const project = await Project.findById(id);
      if (!project)
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });
      const canEdit = role === "superadmin" || project.owner.equals(uid);
      if (!canEdit)
        return res.status(403).json({ success: false, message: "Forbidden" });

      const fields = ["name", "description", "managers", "members"];
      fields.forEach((f) => {
        if (typeof req.body[f] !== "undefined") project[f] = req.body[f];
      });
      await project.save();
      const updated = await Project.findById(project._id)
        .populate("owner", "name email")
        .populate("managers", "name email")
        .populate("members", "name email");

      res.json({ success: true, message: "Project updated", data: updated });
    } catch (err) {
      next(err);
    }
  }

  async remove(req, res, next) {
    try {
      const id = req.params.id;
      const role = req.user.role;
      const uid = req.user.id;

      const project = await Project.findById(id);
      if (!project)
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });

      const canDelete = role === "superadmin" || project.owner.equals(uid);
      if (!canDelete)
        return res.status(403).json({ success: false, message: "Forbidden" });

      await project.deleteOne();
      res.json({ success: true, message: "Project deleted" });
    } catch (e) {
      next(e);
    }
  }

  // ---------- MANAGERS ----------
  async addManagers(req, res, next) {
    try {
      const project = await Project.findById(req.params.id);
      if (!project)
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });
      if (!isOwnerorSA(req, project))
        return res.status(403).json({
          success: false,
          message: "Only owner Admin or Super Admin can modify members",
        });

      const { userIds } = req.body;
      const check = await ensureUsersExistAndRole(userIds, ["manager"]);
      if (!check.ok)
        return res.status(400).json({ success: false, message: check.msg });

      await Project.updateOne(
        { _id: project._id },
        { $addToSet: { managers: { $each: userIds } } }
      );
      const updated = await Project.findById(project._id)
        .populate("managers", "name email")
        .populate("members", "name email");
      res.json({ success: true, message: "Managers added", data: updated });
    } catch (err) {
      next(err);
    }
  }

  async removeManagers(req, res, next) {
    try {
      const project = await Project.findById(req.params.id);
      if (!project)
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });
      if (!isOwnerorSA(req, project))
        return res.status(403).json({
          success: false,
          message: "Only owner Admin or Super Admin can modify members",
        });
      const { userIds } = req.body;

      // pull from managers
      await Project.updateOne(
        { _id: project._id },
        { $pull: { managers: { $in: userIds } } }
      );

      // unassign their tasks in this project (if any were manager-assigned tasks)
      // await Task.updateMany(
      //   { projectId: project._id, assignedTo: { $in: userIds } },
      //   { $set: { assignedTo: null, status: "Pending" } }
      // );
      const updated = await Project.findById(project._id)
        .populate("managers", "name email")
        .populate("members", "name email");
      res.json({
        success: true,
        message: "Managers removed (and tasks unassigned)",
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  }

  // ---------- MEMBERS (EMPLOYEES) ----------

    // GET /projects/:id/members
  async getMembers(req, res, next) {
    try {
      const id = req.params.id;
      if (!isObjectId(id))
        return res.status(400).json({ success: false, message: "Invalid id" });

      const project = await Project.findById(id)
        .select('name managers members owner') // minimal fields
        .populate({
          path: 'managers',
          select: 'name email avatar role',
          populate: { path: 'role', select: 'name' }
        })
        .populate({
          path: 'members',
          select: 'name email avatar role',
          populate: { path: 'role', select: 'name' }
        })
        .lean();

      if (!project)
        return res.status(404).json({ success: false, message: "Project not found" });

      // authorization: visible to owner, superadmin, managers, members
      const uid = req.user?.id;
      const role = req.user?.role;
      const allowed =
        role === 'superadmin' ||
        (project.owner && String(project.owner) === String(uid)) ||
        (project.managers || []).some(m => String(m._id) === String(uid)) ||
        (project.members || []).some(m => String(m._id) === String(uid));

      if (!allowed)
        return res.status(403).json({ success: false, message: 'Forbidden' });

      return res.json({
        success: true,
        data: {
          project: { id: String(project._id), 
          name: project.name },
          managers: project.managers || [],
          members: project.members || []
          
        }
      });
    } catch (err) {
      next(err);
    }
  }
  async addMembers(req, res, next) {
    try {
      const project = await Project.findById(req.params.id);
      if (!project)
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });
      if (!isOwnerorSA(req, project))
        return res
          .status(403)
          .json({
            success: false,
            message: "Only owner Admin or Super Admin can modify members",
          });

      const { userIds } = req.body;
      const check = await ensureUsersExistAndRole(userIds, ["employee"]);
      if (!check.ok)
        return res.status(400).json({ success: false, message: check.msg });

      await Project.updateOne(
        { _id: project._id },
        { $addToSet: { members: { $each: userIds } } }
      );

      const updated = await Project.findById(project._id)
        .populate("managers", "name email")
        .populate("members", "name email");
      res.json({ success: true, message: "Members added", data: updated });
    } catch (err) {
      next(err);
    }
  }

  async removeMembers(req, res, next) {
    try {
      const project = await Project.findById(req.params.id);
      if (!project)
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });
      if (!isOwnerorSA(req, project))
        return res
          .status(403)
          .json({
            success: false,
            message: "Only owner Admin or Super Admin can modify members",
          });

      const { userIds } = req.body;

      await Project.updateOne(
        { _id: project._id },
        { $pull: { members: { $in: userIds } } }
      );

      //unassign tasks belonging to those members in this project
      await Task.updateMany(
        { projectId: project._id, assignedTo: { $in: userIds } },
        { $set: { assignedTo: null, status: 'Pending' } }
      );

      const updated = await Project.findById(project._id)
        .populate("managers", "name email")
        .populate("members", "name email");
      res.json({
        success: true,
        message: "Members removed (and tasks unassigned)",
        data: updated,
      });
    } catch (e) {
      next(e);
    }
  }
}

module.exports = new ProjectController();
