const User = require("../models/User.model");
const Role = require("../models/Role.model");
const Refresh = require("../models/RefreshToken.model");
const Project = require("../models/Project.model");
const Task = require("../models/Task.model");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const {
  sendWelcomeWithCredentials,
  sendRoleChangeNotice,
} = require("../helpers/mail.service");
const hierarchy = ["employee", "manager", "admin", "superadmin"];
function canChange(fromRole, toRole, requesterRole) {
  const from = hierarchy.indexOf(fromRole);
  const to = hierarchy.indexOf(toRole);
  const req = hierarchy.indexOf(requesterRole);
  // requester must outrank both current and target roles
  return req > from && req > to;
}

class UserController {
  async list(req, res, next) {
    try {
      const { page = 1, limit = 10, role, search } = req.query;
      const filter = {};
      if (role) {
        const roleDoc = await Role.findOne({ name: role });
        if (!roleDoc)
          return res.json({
            success: true,
            data: { users: [], page, total: 0 },
          });
        filter.role = roleDoc._id;
      }
      if (search) {
        filter.$or = [
          { name: new RegExp(search, "i") },
          { email: new RegExp(search, "i") },
        ];
      }
      const [users, total] = await Promise.all([
        User.find(filter)
          .populate("role", "name")
          .skip((page - 1) * limit)
          .limit(Number(limit))
          .sort({ createdAt: -1 }),
        User.countDocuments(filter),
      ]);
      res.json({
        success: true,
        data: { users, page: Number(page), limit: Number(limit), total },
      });
    } catch (err) {
      next(err);
    }
  }

  async getone(req, res, next) {
    try {
      const user = await User.findById(req.params.id).populate("role", "name");
      if (!user)
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      res.json({ success: true, data: user });
    } catch (err) {
      next(err);
    }
  }
  async updateRole(req, res, next) {
    try {
      const target = await User.findById(req.params.id).populate(
        "role",
        "name"
      );
      if (!target)
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      const newRole = await Role.findOne({ name: req.body.roleName });
      if (!newRole)
        return res
          .status(400)
          .json({ success: false, message: "Invalid role" });
      const requesterRole = req.user.role; // from JWT
      if (!canChange(target.role.name, newRole.name, requesterRole)) {
        return res.status(403).json({
          success: false,
          message: "Insufficient privilege to change this role",
        });
      }
      target.role = newRole._id;
      await target.save();
      const updated = await User.findById(target._id)
        .select("-passwordHash")
        .populate("role", "name");
      await sendRoleChangeNotice(updated.email, newRole.name);

      res.json({ success: true, message: "Role updated", data: updated });
    } catch (err) {
      next(err);
    }
  }

  async createBySuperAdmin(req, res, next) {
    try {
      const {
        name,
        email,
        password,
        roleName = "employee",
        isVerified = true,
      } = req.body;

      const exists = await User.findOne({ email });
      if (exists)
        return res
          .status(409)
          .json({ success: false, message: "Email already exists" });

      const role = await Role.findOne({ name: roleName });
      if (!role)
        return res
          .status(400)
          .json({ success: false, message: "Invalid role" });

      const providedRaw = req.body.password;
      const provided =
        typeof providedRaw === "string" && providedRaw.trim().length > 0
          ? providedRaw.trim()
          : null;
      const tempPassword =
        provided || `Temp-${crypto.randomBytes(4).toString("hex")}`;

      const user = await User.create({
        name,
        email,
        passwordHash: await bcrypt.hash(tempPassword, 10),
        role: role._id,
        isVerified: true,
        passwordMustChange: true,
      });

      await sendWelcomeWithCredentials(email, roleName, email, tempPassword);

      const populated = await User.findById(user._id)
        .select("-passwordHash")
        .populate("role", "name");

      res.status(201).json({
        success: true,
        message:
          "User created by Super Admin & login credentials sent to email",
        data: populated,
      });
    } catch (err) {
      next(err);
    }
  }

  async deleteUserHard(req, res, next) {
    try {
      const targetId = req.params.id;
      // Prevent accidental self-delete
      if (String(req.user.id) === String(targetId)) {
        return res
          .status(400)
          .json({ success: false, message: "You cannot delete your account." });
      }

      // Ensure target exists
      const target = await User.findById(targetId).populate("role", "name");
      if (!target) {
        return res
          .status(404)
          .json({ success: false, message: "User not Found" });
      }
      //Block deleting another superadmin (if system has multiple)
      if (target.role?.name === "superadmin") {
        return res.status(403).json({
          success: false,
          message: "Cannot delete a Super Admin account.",
        });
      }

      //Remove Refreshtone for this user
      await Refresh.deleteMany({ user: targetId });

      //Pull this user from all projects
      await Project.updateMany(
        {
          $or: [
            { managers: targetId },
            { members: targetId },
            { owner: targetId },
          ],
        },
        { $pull: { managers: targetId, members: targetId } }
        // If they are owner, we keep project but clear owner (or you can transfer ownership)
      );
      // Optional: clear ownership if they owned some projects
      await Project.updateMany({ owner: targetId }, { $unset: { owner: "" } });
      //Unassign all tasks assigned to this user (keep tasks, just make them unassigned)
      await Task.updateMany(
        { assignedTo: targetId },
        { $set: { assignedTo: null, status: "Pending" } }
      );

      //Finally, delete the user
      await User.findByIdAndDelete(targetId);

      return res.json({ success: true, message: "User deleted successfully." });
    } catch (err) {
      next(err);
    }
  }

  async getByEmail(req, res, next) {
    try {
      const u = await User.findOne({ email: req.query.email })
        .select("name email role")
        .populate("role", "name");
      if (!u)
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      res.json({ success: true, data: u });
    } catch (e) {
      next(e);
    }
  }
  async fetchMe(req, res, next) {
    try {
      const me = await User.findById(req.user.id)
      .select('name email avatar')
      .populate('role','name');
    res.json({ success: true, data: me })
    } catch (err) {
      next(err)
    }
  }
}

module.exports = new UserController();
