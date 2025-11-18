// app/services/bot.service.js
const Task = require("../models/Task.model");
const Project = require("../models/Project.model");
const User = require("../models/User.model");

/** Small per-socket memory for "my tasks" lists */
const lastLists = new Map(); // key: socket.id -> [{ _id, title }]

/** Normalize status text to schema values */
const STATUS_CANON = {
  pending: "Pending",
  "in progress": "In Progress",
  in_progress: "In Progress",
  completed: "Completed",
  // passthroughs
  Pending: "Pending",
  "In Progress": "In Progress",
  Completed: "Completed",
};

function canonStatus(input) {
  const raw = String(input || "").trim();
  const key = raw.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
  return STATUS_CANON[raw] || STATUS_CANON[key] || null;
}

function say(io, room, message, extras = {}) {
  io.to(room).emit("chat:message", {
    message,
    isBot: true,
    createdAt: new Date().toISOString(),
    ...extras,
  });
}

/** Find a task using: #index (from last list), shortId prefix, full id, or "quoted title" */
async function resolveTask({ socket, senderId, tokenOrRef }) {
  if (!tokenOrRef) return { error: "No task reference provided." };

  // 1) #index from "my tasks"
  const idxMatch = tokenOrRef.match(/^#(\d+)$/);
  if (idxMatch) {
    const idx = parseInt(idxMatch[1], 10) - 1;
    const list = lastLists.get(socket.id) || [];
    if (!list[idx])
      return {
        error: `I don’t have item #${idxMatch[1]}. Send "my tasks" first.`,
      };
    return { task: await Task.findById(list[idx]._id) };
  }

  // 2) "quoted title"
  const titleMatch = tokenOrRef.match(/^"([^"]+)"$/);
  if (titleMatch) {
    const title = titleMatch[1];
    const found = await Task.find({
      assignedTo: senderId,
      title: new RegExp(`^${title}$`, "i"),
    })
      .select("_id title")
      .limit(5);
    if (found.length === 1) return { task: await Task.findById(found[0]._id) };
    if (found.length > 1) {
      return {
        error:
          "Multiple tasks match that title:\n" +
          found
            .map(
              (t, i) => `${i + 1}. ${t.title} (${String(t._id).slice(0, 6)})`
            )
            .join("\n"),
      };
    }
    return { error: 'No task with that title. Try "my tasks".' };
  }

  // 3) short id prefix (4–24 hex)
  if (/^[a-f0-9]{4,24}$/i.test(tokenOrRef)) {
    if (tokenOrRef.length === 24) {
      const t = await Task.findById(tokenOrRef);
      return t ? { task: t } : { error: `Task not found: ${tokenOrRef}` };
    }
    const candidates = await Task.find({
      assignedTo: senderId,
      _id: { $regex: "^" + tokenOrRef },
    })
      .select("_id title")
      .limit(5);
    if (candidates.length === 1)
      return { task: await Task.findById(candidates[0]._id) };
    if (candidates.length > 1) {
      return {
        error:
          "Multiple matches:\n" +
          candidates
            .map(
              (t, i) => `${i + 1}. ${t.title} (${String(t._id).slice(0, 6)})`
            )
            .join("\n") +
          '\nUse a longer id prefix or "#n" from "my tasks".',
      };
    }
    return {
      error: `I couldn’t find a task for "${tokenOrRef}". Try "my tasks".`,
    };
  }

  return {
    error: 'Unrecognized task reference. Use #n, shortId, full id, or "Title".',
  };
}

function canAssignInProject(project, user) {
  const role = user?.role?.name;
  const isSA = role === "superadmin";
  const isAdmin = role === "admin";
  const isOwner = String(project.owner) === String(user._id);
  const isManager = project.managers?.some(
    (id) => String(id) === String(user._id)
  );
  return isSA || isAdmin || isOwner || isManager;
}

/**
 * Attach bot handlers to a single socket.
 * Usage: const attachBotToSocket = require('./app/services/bot.service');
 *        attachBotToSocket(io, socket);
 */
module.exports = function attachBotToSocket(io, socket) {
  // simple anti-spam (2 msgs/sec)
  let lastAt = 0;
  const minGapMs = 500;
  console.debug(
    "[bot] attachBotToSocket for socket.id=",
    socket.id,
    "user=",
    socket.user ? socket.user.id : "guest"
  );

  // bot respects join requests (idempotent if already joined)
  socket.on("join", (room) => {
    if (typeof room === "string" && room.length) socket.join(room);
    console.debug(
      "[bot] socket joined",
      room,
      " socket.user=",
      socket.user?.id
    );
  });

  socket.on("disconnect", () => {
    lastLists.delete(socket.id);
    console.debug("[bot] disconnect", socket.id);
  });

    // -------------------- GUEST CHAT (socket-based) --------------------
  // Guests (unauthenticated sockets) can talk to a limited bot.
  // Emits replies back only to the requesting socket using 'chat:guest:reply'.
  socket.on('chat:guest', async (payload = {}) => {
    try {
      const text = String(payload.text || '').trim();
      const room = payload.room || 'global';

      if (!text) {
        return socket.emit('chat:guest:reply', {
          reply: 'Please type a question (e.g. "how to create project", "how to invite members").'
        });
      }

      const low = text.toLowerCase();

      // Simple canned help
      if (low === 'help') {
        return socket.emit('chat:guest:reply', {
          reply:
            'I can explain the system. Try: "how to register", "features", "how to create a project", or "what is role-based access".'
        });
      }

      // Short FAQ-style answers (add/edit these to match your app)
      if (low.includes('register') || low.includes('sign up') || low.includes('create account')) {
        return socket.emit('chat:guest:reply', {
          reply:
            'To register: click Register → provide name & email → you will receive login details or verify by email. After login, you can create projects (if you are admin) or be invited as a member.'
        });
      }

      if (low.includes('login') || low.includes('sign in')) {
        return socket.emit('chat:guest:reply', {
          reply:
            'To sign in: click Sign in and use your email/password. If you forgot password, use the reset feature in the login page.'
        });
      }

      if (low.includes('features') || low.includes('what can') || low.includes('what does')) {
        return socket.emit('chat:guest:reply', {
          reply:
            'Core features: project & team management, tasks with status & due dates, role-based access (admin/editor/user), file uploads, and a built-in chat.'
        });
      }

      // If question looks like "how to X" fallback to polite answer
      if (low.startsWith('how') || low.startsWith('what') || low.startsWith('why')) {
        return socket.emit('chat:guest:reply', {
          reply:
            "Good question — this demo bot can provide a short explanation. If you'd like step-by-step, please register and ask from inside the app for interactive task management."
        });
      }

      // Fallback echo + invite to register for full features
      return socket.emit('chat:guest:reply', {
        reply:
          `I received: "${text}". For live task actions (my tasks, status updates, assignment) please sign in — guests can view help and FAQs here.`
      });
    } catch (err) {
      console.error('guest chat error', err);
      socket.emit('chat:guest:reply', { reply: 'Sorry — the guest bot failed to respond.' });
    }
  });


  socket.on("chat:send", async (payload = {}) => {
    try {
      const now = Date.now();
      if (now - lastAt < minGapMs) return; // drop bursts
      lastAt = now;

      const room = payload.room || "global";
      const text = String(payload.message || "").trim();

      // Prefer authoritative senderId from socket.user when available
      const senderId = String(
        payload.senderId || (socket.user && socket.user.id) || ""
      );
      const senderName = String(
        payload.senderName || (socket.user && socket.user.name) || "User"
      );
      if (!senderId) {
        console.debug(
          "[bot] senderId missing (no cookie / auth). payload:",
          payload
        );
      }

      // echo user line
      io.to(room).emit("chat:message", {
        message: text,
        isBot: false,
        senderName,
        createdAt: new Date().toISOString(),
      });
      if (!text) return;

      const low = text.toLowerCase();

      // HELP
      if (low === "help") {
        return say(
          io,
          room,
          `Here are some things I can do:
• my tasks — list your recent tasks (use #1, #2, ...)
• status to <Pending|In Progress|Completed> #<n>
• status to <Pending|In Progress|Completed> <shortId|fullId| "Exact Title">
• assign to <email> <shortId|#n>  — or —  assign <shortId|#n> to <email>
• project summary`
        );
      }

      // MY TASKS
      // if (low === 'my tasks' || low === 'mytasks') {
      //   if (!senderId) return say(io, room, 'I could not detect your user. Please reload and try again.');
      //   const tasks = await Task.find({ assignedTo: senderId })
      //     .sort({ dueDate: 1, createdAt: -1 })
      //     .limit(8)
      //     .select('title status priority dueDate');

      //   lastLists.set(socket.id, tasks.map(t => ({ _id: String(t._id), title: t.title })));

      //   if (!tasks.length) return say(io, room, 'You have no assigned tasks.');
      //   const lines = tasks.map((t,i) => {
      //     const due = t.dueDate ? new Date(t.dueDate).toLocaleDateString() : '—';
      //     return `${i+1}. ${t.title}  [${t.status}]  (${t.priority})  Due: ${due}`;
      //   }).join('\n');
      //   return say(io, room, `Your tasks:\n${lines}\n\nTip: use #<n> in commands.`);
      // }

      if (low === "my tasks" || low === "mytasks") {
        if (!senderId)
          return say(
            io,
            room,
            "I could not detect your user. Please reload and try again."
          );

        const tasks = await Task.find({ assignedTo: senderId })
          .sort({ dueDate: 1, createdAt: -1 })
          .limit(8)
          .select("title status priority dueDate projectId");

        lastLists.set(
          socket.id,
          tasks.map((t) => ({ _id: String(t._id), title: t.title }))
        );

        if (!tasks.length) return say(io, room, "You have no assigned tasks.");

        // build textual lines for chat (unchanged)
        const lines = tasks
          .map((t, i) => {
            const due = t.dueDate
              ? new Date(t.dueDate).toLocaleDateString()
              : "—";
            return `${i + 1}. ${t.title}  [${t.status}]  (${
              t.priority
            })  Due: ${due}`;
          })
          .join("\n");

        // Prepare structured tasks array to send to client (client-side expects fields: id, idx, title, status, priority, dueDate, projectId)
        const structured = tasks.map((t, i) => ({
          id: String(t._id),
          idx: i + 1,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate ? t.dueDate.toISOString() : null,
          projectId: t.projectId ? String(t.projectId) : null,
        }));

        // Send both readable text and structured tasks in extras
        return say(
          io,
          room,
          `Your tasks:\n${lines}\n\nTip: use #<n> in commands.`,
          { tasks: structured }
        );
      }

      // PROJECT SUMMARY
      if (low === "project summary" || low === "projectsummary") {
        const total = await Project.countDocuments({});
        const agg = await Task.aggregate([
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]);
        const counts = { Pending: 0, "In Progress": 0, Completed: 0 };
        agg.forEach((a) => {
          counts[a._id] = a.count;
        });
        return say(
          io,
          room,
          `Summary:
• Projects: ${total}
• Tasks — Pending: ${counts["Pending"] || 0}, In Progress: ${
            counts["In Progress"] || 0
          }, Completed: ${counts["Completed"] || 0}`
        );
      }

      // STATUS TO …
      if (low.startsWith("status to")) {
        const rest = text.slice("status to".length).trim();
        if (!rest)
          return say(
            io,
            room,
            'Usage: status to <Pending|In Progress|Completed> <#n|shortId|fullId|"Title">'
          );

        // split while preserving quoted title
        const tokens = [];
        rest.replace(/"([^"]+)"|(\S+)/g, (_, q, w) => tokens.push(q ?? w));
        if (tokens.length < 2)
          return say(
            io,
            room,
            'Usage: status to <Status> <#n|shortId|id|"Title">'
          );

        const ref = tokens[tokens.length - 1];
        const statusText = tokens.slice(0, -1).join(" ");
        const next = canonStatus(statusText);
        if (!next)
          return say(
            io,
            room,
            "Invalid status. Use Pending, In Progress, or Completed."
          );

        const { task, error } = await resolveTask({
          socket,
          senderId,
          tokenOrRef: /[#"]/i.test(ref) ? ref : ref,
        });
        if (error) return say(io, room, error);
        if (!task) return say(io, room, "Task not found.");

        const allowed = String(task.assignedTo || "") === senderId; // (API will re-enforce on REST side)
        if (!allowed)
          return say(io, room, "You are not allowed to update this task here.");

        if (task.status === next)
          return say(io, room, `Status already "${next}".`);
        task.status = next;
        await task.save();

        // live update your tasks UI
        io.to(`project:${String(task.projectId)}`).emit("task:status_changed", {
          taskId: String(task._id),
          projectId: String(task.projectId),
          title: task.title,
          status: next,
          by: senderId,
          at: new Date().toISOString(),
        });

        return say(
          io,
          room,
          `Updated status to "${next}" for "${task.title}".`
        );
      }

      // ASSIGN …
      if (low.startsWith("assign ")) {
        const words = text.trim().match(/"([^"]+)"|(\S+)/g) || [];
        let email = null;
        let ref = null;

        // syntax A: assign to <email> <ref>
        if (words[1]?.toLowerCase() === "to" && words.length >= 4) {
          email = words[2].replace(/^"|"$/g, "");
          ref = words.slice(3).join(" ").replace(/^"|"$/g, "");
        } else {
          // syntax B: assign <ref> to <email>
          const toIdx = words.findIndex((w) => w.toLowerCase() === "to");
          if (toIdx > 0 && toIdx < words.length - 1) {
            ref = words.slice(1, toIdx).join(" ").replace(/^"|"$/g, "");
            email = words
              .slice(toIdx + 1)
              .join(" ")
              .replace(/^"|"$/g, "");
          }
        }

        if (!email || !ref) {
          return say(
            io,
            room,
            'Usage:\n• assign to <email> <#n|shortId|id|"Title">\n• assign <#n|shortId|id|"Title"> to <email>'
          );
        }

        const sender = await User.findById(senderId).populate("role", "name");
        if (!sender)
          return say(
            io,
            room,
            "Could not identify you. Please reload and try again."
          );

        const { task, error } = await resolveTask({
          socket,
          senderId,
          tokenOrRef: ref.match(/^#\d+$/)
            ? ref
            : /^".+"$/.test(ref)
            ? ref
            : ref,
        });
        if (error) return say(io, room, error);
        if (!task) return say(io, room, "Task not found.");

        const project = await Project.findById(task.projectId);
        if (!project) return say(io, room, "Project not found for this task.");

        if (!canAssignInProject(project, sender)) {
          return say(
            io,
            room,
            "You are not allowed to assign tasks in this project."
          );
        }

        const assignee = await User.findOne({ email }).populate("role", "name");
        if (!assignee) return say(io, room, `User not found: ${email}`);
        if (!["manager", "employee"].includes(assignee.role?.name)) {
          return say(io, room, "Assignee must be a manager or employee.");
        }

        const inManagers = project.managers?.some(
          (id) => String(id) === String(assignee._id)
        );
        const inMembers = project.members?.some(
          (id) => String(id) === String(assignee._id)
        );
        if (!(inManagers || inMembers)) {
          return say(
            io,
            room,
            "Assignee is not part of this project. Add them as member/manager first."
          );
        }

        task.assignedTo = assignee._id;
        const done = (task.status || "").toLowerCase();
        if (done === "completed" || done === "in progress")
          task.status = "Pending";
        await task.save();

        io.to(`project:${String(task.projectId)}`).emit("task:status_changed", {
          taskId: String(task._id),
          projectId: String(task.projectId),
          title: task.title,
          status: task.status,
          by: String(sender._id),
          at: new Date().toISOString(),
        });

        return say(
          io,
          room,
          `Assigned "${task.title}" to ${assignee.name || assignee.email}.`
        );
      }

      // Fallback
      return say(
        io,
        room,
        "Sorry, I only understand: help, my tasks, project summary, status to …, assign …"
      );
    } catch (err) {
      console.error("chat:send error:", err);
      try {
        say(io, payload?.room || "global", "Something went wrong.");
      } catch {}
    }
  });
};
