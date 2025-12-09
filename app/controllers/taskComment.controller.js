const mongoose = require("mongoose");
const Task = require("../models/Task.model");
const Project = require("../models/Project.model");
const ActivityLog = require("../models/ActivityLog.model");

const {
  uploadToCloudinary,
  deleteFromCloudinary,
} = require("../middlewares/upload");

/* ---------------- Permission helpers ---------------- */
function isSA(req) {
  return req.user?.role === "superadmin";
}
function isAdmin(req) {
  return req.user?.role === "admin";
}
function isManager(req) {
  return req.user?.role === "manager";
}

function isOwnerOrSA(req, project) {
  if (isSA(req)) return true;
  return String(project.owner) === String(req.user.id);
}
function isProjectManager(project, userId) {
  return (project.managers || []).some((id) => String(id) === String(userId));
}
function isProjectMember(project, userId) {
  return (project.members || []).some((id) => String(id) === String(userId));
}
function canManageProject(req, project) {
  return (
    isSA(req) ||
    isAdmin(req) ||
    isOwnerOrSA(req, project) ||
    isProjectManager(project, req.user.id)
  );
}
async function canSeeProject(req, project) {
  return (
    isSA(req) ||
    isOwnerOrSA(req, project) ||
    isProjectManager(project, req.user.id) ||
    isProjectMember(project, req.user.id)
  );
}

/* ---------------- Small utils ---------------- */
const sanitizeText = (s, max = 2000) =>
  String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

class TaskCommentController {
  /* ==========================
   Add comment (with files[])
   ========================== */
  async addComment(req, res, next) {
    try {
      const { taskId } = req.params;
      if (!isObjectId(taskId))
        return res
          .status(400)
          .json({ success: false, message: "Invalid task id" });

      const task = await Task.findById(taskId);
      if (!task)
        return res
          .status(404)
          .json({ success: false, message: "Task not found" });
      const project = await Project.findById(task.projectId);
      if (!project)
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });

      // Who can comment: SA/Admin/Owner/Manager/Member (assignee is a member typically)
      if (!(await canSeeProject(req, project))) {
        return res.status(403).json({ success: false, message: "Not allowed" });
      }
      const text = sanitizeText(req.body.text, 2000);
      if (!text && !(Array.isArray(req.files) && req.files.length)) {
        return res
          .status(400)
          .json({ success: false, message: "Write a message or attach files" });
      }
      // Upload files concurrently (if present)
      let files = [];
      if (Array.isArray(req.files) && req.files.length) {
        // cap at 5 files per comment (defensive)
        const batch = req.files.slice(0, 5);
        const uploads = await Promise.all(
          batch.map((f) =>
            uploadToCloudinary(f.buffer, {
              folder: "teamboard/comments",
              resource_type: "auto",
            }).then((up) => ({
              url: up.url,
              publicId: up.publicId,
              name: f.originalname,
              size: f.size,
              type: f.mimetype,
            }))
          )
        );
        files = uploads;
      }
      const comment = {
        by: req.user.id,
        text,
        files,
      };

      task.comments.push(comment);
      await task.save();

      const saved = task.comments[task.comments.length - 1];
      await ActivityLog.create({
        userId: req.user.id,
        action: "task.comment_added",
        entity: "Task",
        entityId: task._id,
        projectId: task.projectId,
        metadata: { text: comment.text },
      });

      // Realtime
      const io = req.app.get("io");
      io?.to(`project:${String(task.projectId)}`).emit("task:comment_added", {
        taskId: String(task._id),
        projectId: String(task.projectId),
        comment: {
          _id: String(saved._id),
          by: String(req.user.id),
          text: saved.text,
          files: saved.files,
          createdAt: saved.createdAt || new Date().toISOString(),
        },
      });

      return res
        .status(201)
        .json({ success: true, message: "Comment added", data: saved });
    } catch (err) {
      next(err);
    }
  }

  /* ==========================
   List comments (populated)
   ========================== */

  async listComments(req, res, next) {
    try {
      const { taskId } = req.params;
      if (!isObjectId(taskId))
        return res
          .status(400)
          .json({ success: false, message: "Invalid task id" });

      const task = await Task.findById(taskId).populate({
        path: "comments.by",
        select: "name email role",
        populate: { path: "role", select: "name" },
      });
      if (!task)
        return res
          .status(404)
          .json({ success: false, message: "Task not found" });

      const project = await Project.findById(task.projectId);
      if (!project)
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });
      if (!(await canSeeProject(req, project))) {
        return res.status(403).json({ success: false, message: "Not allowed" });
      }

      return res.json({ success: true, data: task.comments });
    } catch (err) {
      next(err);
    }
  }

  /* ==========================
   Delete comment
   ========================== */

  async deleteComment(req, res, next) {
    try {
      const { taskId, commentId } = req.params;
      if (!isObjectId(taskId) || !isObjectId(commentId))
        return res
          .status(400)
          .json({ success: false, message: "Invalid id(s)" });

      const task = await Task.findById(taskId);
      if (!task)
        return res
          .status(404)
          .json({ success: false, message: "Task not found" });

      const project = await Project.findById(task.projectId);
      if (!project)
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });

      const c = task.comments.id(commentId);
      if (!c)
        return res
          .status(404)
          .json({ success: false, message: "Comment not found" });

      const isAuthor = String(c.by) === String(req.user.id);
      if (!(isAuthor || canManageProject(req, project))) {
        return res.status(403).json({ success: false, message: "Not allowed" });
      }

      // delete any files in Cloudinary
      if (Array.isArray(c.files)) {
        await Promise.all(
          c.files.map((f) =>
            f.publicId ? deleteFromCloudinary(f.publicId).catch(() => {}) : null
          )
        );
      }

      c.deleteOne(); // subdocument remove
      await task.save();

      // realtime
      const io = req.app.get("io");
      io?.to(`project:${String(task.projectId)}`).emit("task:comment_removed", {
        taskId: String(task._id),
        projectId: String(task.projectId),
        commentId: String(commentId),
      });

      return res.json({ success: true, message: "Comment removed" });
    } catch (err) {
      next(err);
    }
  }

  /* ==========================
   Add attachment (single or multi)
   ========================== */

  // async addAttachment(req, res, next) {
  //   try {
  //     const { taskId } = req.params;

  //     // 0) Validate IDs
  //     if (!isObjectId(taskId)) {
  //       return res
  //         .status(400)
  //         .json({ success: false, message: "Invalid task id" });
  //     }

  //     // 1) Load task + project
  //     const task = await Task.findById(taskId);
  //     if (!task)
  //       return res
  //         .status(404)
  //         .json({ success: false, message: "Task not found" });

  //     const project = await Project.findById(task.projectId);
  //     if (!project)
  //       return res
  //         .status(404)
  //         .json({ success: false, message: "Project not found" });

  //     // 2) Permission: members/managers/owner/SA can attach
  //     if (!(await canSeeProject(req, project))) {
  //       return res.status(403).json({ success: false, message: "Not allowed" });
  //     }

  //     // 3) Collect files from either single or multiple upload shapes
  //     const incoming = Array.isArray(req.files)
  //       ? req.files
  //       : req.file
  //       ? [req.file]
  //       : [];
  //     if (!incoming.length) {
  //       return res
  //         .status(400)
  //         .json({ success: false, message: "No file uploaded" });
  //     }

  //     // Cap to 10 per request just in case
  //     const batch = incoming.slice(0, 10);

  //     // Decide resource_type by mimetype (PDF/ZIP/etc => 'raw', images => 'image')
  //     const resourceTypeFor = (mime = "") =>
  //       mime.startsWith("image/") ? "image" : "raw";

  //     // 4) Upload – fail fast on first error (simple and predictable)
  //     const uploaded = [];
  //     for (const f of batch) {
  //       const up = await uploadToCloudinary(f.buffer, {
  //         folder: "teamboard/attachments",
  //         resource_type: resourceTypeFor(f.mimetype),
  //       });

  //       console.log("Original Cloudinary URL:", up.url);
  //       console.log("Original File Name:", f.originalname);

  //       if (!up || up.error) {
  //         console.error(
  //           "Cloudinary upload failed for:",
  //           f.originalname,
  //           up?.error
  //         );
  //         // Skip this file if the upload failed
  //         continue;
  //       }

  //       // Extract the extension from the original file name (e.g., '.pdf')
  //       const fileExtensionMatch = f.originalname.match(/\.\w+$/);
  //       const extension = fileExtensionMatch ? fileExtensionMatch[0] : "";

  //       const baseUrl = up.secure_url || up.url;

  //       let finalUrl = baseUrl;
  //       if (
  //         resourceTypeFor(f.mimetype) === "raw" &&
  //         !baseUrl.endsWith(extension)
  //       ) {
  //         finalUrl += extension;
  //       }
  //       uploaded.push({
  //         url: up.secure_url || up.url,  // PDF/ZIP/etc will be .../raw/upload/...
  //         publicId: up.public_id || up.publicId,
  //         name: f.originalname,
  //         size: f.size,
  //         type: f.mimetype,
  //         by: req.user.id,
  //         resourceType: resourceTypeFor(f.mimetype), // optional but handy for UI
  //       });
  //     }

  //     // 5) Persist
  //     task.attachments.push(...uploaded);
  //     await task.save();

  //     // 6) Realtime notify the project room
  //     const io = req.app.get("io");
  //     io?.to(`project:${String(task.projectId)}`).emit(
  //       "task:attachment_added",
  //       {
  //         taskId: String(task._id),
  //         projectId: String(task.projectId),
  //         attachments: uploaded,
  //       }
  //     );

  //     // 7) Done
  //     return res.status(201).json({
  //       success: true,
  //       message: `${uploaded.length} attachment(s) added`,
  //       data: uploaded,
  //     });
  //   } catch (e) {
  //     next(e);
  //   }
  // }

  async addAttachment(req, res, next) {
  try {
    const { taskId } = req.params;

    // 0) Validate ID
    if (!isObjectId(taskId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid task id" });
    }

    // 1) Load task + project
    const task = await Task.findById(taskId);
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

    // 2) Permission: members/managers/owner/SA can attach
    if (!(await canSeeProject(req, project))) {
      return res
        .status(403)
        .json({ success: false, message: "Not allowed" });
    }

    // 3) Collect files from either single or multiple upload shapes
    const incoming = Array.isArray(req.files)
      ? req.files
      : req.file
      ? [req.file]
      : [];

    if (!incoming.length) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    // Cap to 10 per request just in case
    const batch = incoming.slice(0, 10);

    // 4) Upload – fail fast on first error (simple and predictable)
    const uploaded = [];

    for (const f of batch) {
      const up = await uploadToCloudinary(f.buffer, {
        folder: "teamboard/attachments",
        resource_type: "auto", // ✅ let Cloudinary detect (image, pdf, zip, doc, etc.)
      });

      if (!up || up.error) {
        console.error(
          "Cloudinary upload failed for:",
          f.originalname,
          up?.error
        );
        continue;
      }

      console.log("Cloudinary URL:", up.secure_url || up.url);
      console.log("Original File Name:", f.originalname);

      uploaded.push({
        url: up.secure_url || up.url,         // ✅ use Cloudinary URL as-is
        publicId: up.public_id || up.publicId,
        name: f.originalname,
        size: f.size,
        type: f.mimetype,
        by: req.user.id,
      });
    }

    if (!uploaded.length) {
      return res
        .status(500)
        .json({ success: false, message: "Upload failed for all files" });
    }

    // 5) Persist
    task.attachments.push(...uploaded);
    await task.save();

    // 6) Realtime notify the project room
    const io = req.app.get("io");
    io?.to(`project:${String(task.projectId)}`).emit(
      "task:attachment_added",
      {
        taskId: String(task._id),
        projectId: String(task.projectId),
        attachments: uploaded,
      }
    );

    // 7) Done
    return res.status(201).json({
      success: true,
      message: `${uploaded.length} attachment(s) added`,
      data: uploaded,
    });
  } catch (e) {
    next(e);
  }
}


  /* ==========================
   Delete one attachment by publicId
   ========================== */

  async deleteAttachment(req, res, next) {
    try {
      const taskId = req.params.taskId;
      // prefer body first (our new safe route), fallback to params if you keep the old one
      const publicIdRaw = req.body.publicId || req.params.publicId || "";
      const publicId = decodeURIComponent(publicIdRaw);

      if (!isObjectId(taskId) || !publicId) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid params" });
      }

      const task = await Task.findById(taskId);
      if (!task)
        return res
          .status(404)
          .json({ success: false, message: "Task not found" });

      const project = await Project.findById(task.projectId);
      if (!project)
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });

      if (!(await canSeeProject(req, project))) {
        return res.status(403).json({ success: false, message: "Not allowed" });
      }

      const ix = task.attachments.findIndex((a) => a.publicId === publicId);
      if (ix === -1) {
        return res
          .status(404)
          .json({ success: false, message: "Attachment not found" });
      }

      try {
        await deleteFromCloudinary(publicId);
      } catch {}

      const removed = task.attachments.splice(ix, 1)[0];
      await task.save();

      const io = req.app.get("io");
      io?.to(`project:${String(task.projectId)}`).emit(
        "task:attachment_removed",
        {
          taskId: String(task._id),
          projectId: String(task.projectId),
          publicId,
        }
      );

      return res.json({
        success: true,
        message: "Attachment removed",
        data: removed,
      });
    } catch (e) {
      next(e);
    }
  }
}
module.exports = new TaskCommentController();
