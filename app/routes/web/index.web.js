// app/routes/web/index.web.js
require("dotenv").config();

const router = require("express").Router();
const axios = require("axios");
const multer = require("multer");
const FormData = require("form-data");

const webAuth = require("../../middlewares/webAuth");
const webRbac = require("../../middlewares/webRbac");
const jwt=require("jsonwebtoken")

// If you already have a dedicated avatar upload middleware, keep it:
const { avatarUpload, attachmentUpload } = require("../../middlewares/upload");

// Controllers / Models
const profileCtrl = require("../../controllers/profile.controller");
const Project = require("../../models/Project.model");
const User = require("../../models/User.model");
const Task = require("../../models/Task.model"); // <- needed for /tasks/:id SSR details

const BASE =
  process.env.WEB_API_BASE || `http://localhost:${process.env.PORT || 5000}`;
const canEditProject = (role) => ["superadmin", "admin"].includes(role);

// Helper: can the current user view this project?
function canViewProject(project, user) {
  if (!project || !user) return false;

  const role = (user.role || "").toLowerCase();
  const uid = String(user.id);

  const normalizeId = (val) =>
    val && typeof val === "object" && val._id ? String(val._id) : String(val);

  const ownerId = project.owner ? normalizeId(project.owner) : null;

  const isOwner = ownerId && ownerId === uid;

  const isManager =
    Array.isArray(project.managers) &&
    project.managers.some((m) => normalizeId(m) === uid);

  const isMember =
    Array.isArray(project.members) &&
    project.members.some((m) => normalizeId(m) === uid);

  return role === "superadmin" || isOwner || isManager || isMember;
}


/* -------------------------------------------------
   API helper: sends request with AT; on 401 refreshes,
   stores new AT cookie, then retries once.
-------------------------------------------------- */
async function api(req, res, config) {
  const at = req.signedCookies.AT || req.cookies.AT || "";
  const headers = {
    ...(config.headers || {}),
    Authorization: at ? `Bearer ${at}` : undefined,
    Cookie: req.headers.cookie || "",
  };

  try {
    return await axios.request({ ...config, headers, withCredentials: true });
  } catch (err) {
    if (err.response?.status !== 401) throw err;
  }

  // Try refresh once
  const r = await axios.post(
    `${BASE}/api/auth/refresh`,
    {},
    { headers: { Cookie: req.headers.cookie || "" }, withCredentials: true }
  );
  const newAT = r.data?.data?.accessToken;
  if (!newAT) throw new Error("No access token from refresh");

  // set new AT for subsequent SSR calls
  res.cookie("AT", newAT, {
    httpOnly: true,
    signed: !!process.env.COOKIE_SECRET,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 15 * 60 * 1000,
  });

  const retryHeaders = {
    ...(config.headers || {}),
    Authorization: `Bearer ${newAT}`,
    Cookie: req.headers.cookie || "",
  };
  return axios.request({
    ...config,
    headers: retryHeaders,
    withCredentials: true,
  });
}

const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || "rt";

const rtCookieClearOptions = {
  httpOnly: true,
  signed: !!process.env.COOKIE_SECRET,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/", // CRITICAL: Must match the path used to SET the cookie!
};

//Landing page

router.get("/", (req, res) => {
  // if logged in send them to dashboard, otherwise show landing
  if (res.locals.user) return res.redirect("/dashboard");
  return res.render("landing", { layout: false });
});

router.get("/chat/guest", (req, res) => {
  res.render("chat/guest", { layout: false, room: "global", me: {} });
});
/* =================================================
   AUTH PAGES
================================================= */
// GET: Render the form to submit email
router.get("/forgot-password", (req, res) =>
  res.render("auth/forgot-password", { form: {} })
);

// POST: Submit email to the API
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    // Call API
    await axios.post(
      `${BASE}/api/auth/forgot-password`,
      { email },
      { withCredentials: true }
    );
    req.flash(
      "success",
      "If an account exists, a password reset link has been sent to your email."
    );
    return res.redirect("/forgot-password");
  } catch (e) {
    req.flash(
      "error",
      e.response?.data?.message || "Failed to process request."
    );
    return res.redirect("/forgot-password");
  }
});

// GET: Render the password reset form (linked from email)
router.get("/reset-password", (req, res) => {
  const { token } = req.query;
  if (!token) {
    req.flash("error", "Invalid reset link: Token is missing.");
    return res.redirect("/login");
  }
  // Render the form, passing the token as a hidden field
  res.render("auth/reset-password", { token, form: {} });
});

// POST: Submit the new password to the API
router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword, confirmPassword } = req.body;
    if (newPassword !== confirmPassword) {
      req.flash(
        "error",
        "New password and confirmation password do not match."
      );
      return res.redirect(`/reset-password?token=${token}`);
    }

    // Call API
    await axios.post(
      `${BASE}/api/auth/reset-password`,
      { token, newPassword, confirmPassword },
      { withCredentials: true }
    );

    req.flash(
      "success",
      "Password reset successful! Please log in with your new password."
    );
    return res.redirect("/login");
  } catch (e) {
    const msg =
      e.response?.data?.message ||
      e.message ||
      "Failed to reset password. Link may have expired.";
    req.flash("error", msg);
    // Redirect back to the form, preserving the token in the URL
    return res.redirect(`/reset-password?token=${req.body.token}`);
  }
});

router.get("/login", (req, res) => res.render("auth/login",{ mode:null }));

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const r = await axios.post(
      `${BASE}/api/auth/login`,
      { email, password },
      { withCredentials: true }
    );

    // forward refresh cookie(s) from API to browser
    const setCookie = r.headers["set-cookie"];
    if (setCookie && setCookie.length) {
      res.setHeader("Set-Cookie", setCookie);
    }

    const at = r.data?.data?.accessToken;
    res.cookie("AT", at, {
      httpOnly: true,
      signed: !!process.env.COOKIE_SECRET,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 15 * 60 * 1000,
    });
    req.flash("success", "Welcome back!");
    return res.redirect("/dashboard");
  } catch (e) {
    req.flash(
      "error",
      e.response?.data?.message || "Invalid email or password"
    );
    return res.redirect("/login");
  }
});

router.get("/authority/login", (req, res) => {
  res.render("auth/login", { mode: "authority" });
});

router.post("/authority/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1) Call the SAME API login endpoint
   const r = await axios.post(
      `${BASE}/api/auth/login`,
      { email, password },
      { withCredentials: true }
    );

    // Forward refresh cookie(s) from API (so RT stays in sync)
    const setCookie = r.headers["set-cookie"];
    if (setCookie && setCookie.length) {
      res.setHeader("Set-Cookie", setCookie);
    }

    const at = r.data?.data?.accessToken;
    if (!at) {
      req.flash("error", "No access token returned from server");
      return res.redirect("/authority/login");
    }

    // 2) Decode token to check role
    let role = "";
    try {
      const payload = jwt.verify(at, process.env.JWT_ACCESS_SECRET);
      role = (payload.role || "").toLowerCase();
    } catch (err) {
      console.error("Authority login token verify fail:", err.message);
      req.flash("error", "Unable to verify login token");
      return res.redirect("/authority/login");
    }

    const allowed = ["superadmin", "admin", "manager"];
    if (!allowed.includes(role)) {
      // Not an authority role → don’t let them use this login
      // Optional: clear AT + inform user
      res.clearCookie("AT", {
        httpOnly: true,
        signed: !!process.env.COOKIE_SECRET,
        sameSite: "lax",
      });

      req.flash(
        "error",
        "Only SuperAdmin / Admin / Manager can use this login."
      );
      return res.redirect("/authority/login");
    }

    // 3) Set AT cookie only if role is allowed
    res.cookie("AT", at, {
      httpOnly: true,
      signed: !!process.env.COOKIE_SECRET,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 15 * 60 * 1000,
    });

    // 4) Redirect to authority area (or same dashboard)
    req.flash("success", `Welcome, ${role}!`);
    // if you have /admin dashboard, use that; else keep /dashboard
    return res.redirect("/dashboard");
  } catch (e) {
    console.error(
      "Authority login error:",
      e.response?.status,
      e.response?.data || e.message
    );
    req.flash(
      "error",
      e.response?.data?.message || "Authority login failed"
    );
    return res.redirect("/authority/login");
  }
});



router.get("/logout", async (req, res) => {
  try {
    await axios.post(
      `${BASE}/api/auth/logout`,
      {},
      { withCredentials: true, headers: { Cookie: req.headers.cookie || "" } }
    );
  } catch (_) {}
  res.clearCookie("AT", {
    httpOnly: true,
    signed: !!process.env.COOKIE_SECRET,
    sameSite: "lax",
    path: "/",
  });
  res.clearCookie(REFRESH_COOKIE_NAME, rtCookieClearOptions);

  const role=(res.locals.user?.role||"").toLowerCase()
  if(role==="superadmin"||role==="admin"||role==="manager"){
    return res.redirect("/authority/login")
  }
  return res.redirect("/login");
});

// --- Change password (web) ---

// GET: render change password form
router.get("/profile/change-password", webAuth(true), async (req, res) => {
  try {
    // render view with any flash messages
    return res.render("profile/change-password", { form: {} });
  } catch (err) {
    req.flash("error", "Failed to open change password page");
    return res.redirect("/profile");
  }
});

// POST: submit to API
router.post("/profile/change-password", webAuth(true), async (req, res) => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    if (!oldPassword || !newPassword || !confirmPassword) {
      req.flash("error", "Please fill all fields");
      return res.redirect("/profile/change-password");
    }
    if (newPassword !== confirmPassword) {
      req.flash("error", "New password and confirm password do not match");
      return res.redirect("/profile/change-password");
    }

    // call API (uses your api() helper so it will refresh AT if needed)
    await api(req, res, {
      url: `${BASE}/api/auth/change-password`,
      method: "PUT",
      data: {
        oldPassword,
        newPassword,
      },
    });

    // On success: show message and redirect to profile/dashboard
    req.flash("success", "Password updated successfully");
    return res.redirect("/login");
  } catch (e) {
    const msg =
      e.response?.data?.message || e.message || "Failed to change password";
    req.flash("error", msg);
    return res.redirect("/profile/change-password");
  }
});

/* =================================================
   DASHBOARD
================================================= */
router.get("/", (req, res) => res.redirect("/dashboard"));

router.get("/dashboard", webAuth(true), async (req, res) => {
  try {
    const r = await api(req, res, {
      url: `${BASE}/api/analytics/summary`,
      method: "GET",
    });
    const data = r.data?.data || null;
    return res.render("dashboard/index", { data });
  } catch (e) {
    req.flash("error", e.response?.data?.message || "Failed to load dashboard");
    return res.render("dashboard/index", { data: null });
  }
});

/* =================================================
   USERS
================================================= */
router.get("/users", webAuth(true), webRbac("admin"), async (req, res) => {
  try {
    const r = await api(req, res, { url: `${BASE}/api/users`, method: "GET" });
    res.render("users/index", { users: r.data.data.users });
  } catch (e) {
    res
      .status(500)
      .render("errors/500", { error: e.response?.data?.message || e.message });
  }
});

router.get(
  "/users/create",
  webAuth(true),
  webRbac("superadmin"),
  (req, res) => {
    res.render("users/create");
  }
);

router.post(
  "/users/create",
  webAuth(true),
  webRbac("superadmin"),
  async (req, res) => {
    try {
      await api(req, res, {
        url: `${BASE}/api/users`,
        method: "POST",
        data: req.body,
      });
      req.flash("success", "User created and credentials emailed.");
      return res.redirect("/users");
    } catch (e) {
      req.flash("error", e.response?.data?.message || "Failed to create user");
      return res.redirect("/users/create");
    }
  }
);

/* Update a user's role (Super Admin) */
router.post(
  "/users/:id/role",
  webAuth(true),
  webRbac("superadmin"),
  async (req, res) => {
    const { id } = req.params;
    const { roleName } = req.body;
    try {
      await api(req, res, {
        url: `${BASE}/api/users/${id}/role`,
        method: "PUT",
        data: { roleName },
      });
      req.flash("success", "User role updated.");
    } catch (e) {
      req.flash("error", e.response?.data?.message || "Failed to update role");
    }
    return res.redirect("/users");
  }
);

router.post(
  "/users/:id/delete",
  webAuth(true),
  webRbac("superadmin"),
  async (req, res) => {
    try {
      await api(req, res, {
        url: `${BASE}/api/users/${req.params.id}`,
        method: "DELETE",
      });
      req.flash("success", "User deleted successfully");
    } catch (e) {
      req.flash("error", e.response?.data?.message || "Delete failed");
    }
    res.redirect("/users");
  }
);

/* =================================================
   PROJECTS
================================================= */
router.get("/projects", webAuth(true), async (req, res, next) => {
  try {
    const r = await axios.get(`${BASE}/api/projects`, {
      headers: { Cookie: req.headers.cookie || "" },
      withCredentials: true,
    });

    // normalise response to an array
    let projects = [];
    if (r.data && r.data.success && r.data.data) {
      if (Array.isArray(r.data.data.projects)) {
        projects = r.data.data.projects;
      } else if (Array.isArray(r.data.data)) {
        projects = r.data.data;
      }
    }

    // Defensive: ensure projects is an array
    projects = projects || [];

    // Server-side format createdAt into a display string
    projects = projects.map((p) => {
      // p.createdAt might be a string or Date or missing
      const created = p && p.createdAt ? new Date(p.createdAt) : null;
      return {
        // keep original fields (note: if `p` is a mongoose doc, spread converts it to plain fields)
        ...p,
        createdAtFormatted:
          created && !isNaN(created.getTime())
            ? created.toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })
            : "—",
      };
    });

    // debug logs (optional - you can remove)
    console.log("First project:", projects[0]);
    console.log("Projects received:", projects.length);
    // render
    res.render("projects/index", { projects });
  } catch (err) {
    console.error("projects web fetch failed", err?.message || err);
    res.render("projects/index", { projects: [] });
  }
});

router.get("/projects/create", webAuth(true), webRbac("admin"), (req, res) => {
  res.render("projects/create");
});

router.post(
  "/projects/create",
  webAuth(true),
  webRbac("admin"),
  async (req, res) => {
    try {
      await api(req, res, {
        url: `${BASE}/api/projects`,
        method: "POST",
        data: req.body,
      });
      req.flash("success", "Project created successfully.");
      return res.redirect("/projects");
    } catch (e) {
      req.flash(
        "error",
        e.response?.data?.message || "Failed to create project"
      );
      return res.redirect("/projects/create");
    }
  }
);

/* Project details via DB (keeps populated members/managers) */
// router.get("/projects/:id", webAuth(true), async (req, res) => {
//   try {
//     const project = await Project.findById(req.params.id)
//       .populate({ path: "owner", select: "name email" })
//       .populate({
//         path: "managers",
//         select: "name email role",
//         populate: { path: "role", select: "name" },
//       })
//       .populate({
//         path: "members",
//         select: "name email role",
//         populate: { path: "role", select: "name" },
//       });

//     if (!project) {
//       req.flash("error", "Project not found");
//       return res.redirect("/projects");
//     }

//     const counts = {
//       managers: (project.managers || []).length,
//       members: (project.members || []).length,
//     };
//     res.render("projects/show", { project, counts });
//   } catch (e) {
//     req.flash("error", "Failed to load project");
//     res.redirect("/projects");
//   }
// });

router.get("/projects/:id", webAuth(true), async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate({ path: "owner", select: "name email" })
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

    if (!project) {
      req.flash("error", "Project not found");
      return res.redirect("/projects");
    }

    const me = res.locals.user;
    if (!canViewProject(project, me)) {
      req.flash("error", "Forbidden: you are not part of this project");
      return res.redirect("/projects");
    }

    const counts = {
      managers: (project.managers || []).length,
      members: (project.members || []).length,
    };

    return res.render("projects/show", { project, counts });
  } catch (e) {
    console.error("Project show error:", e);
    req.flash("error", "Failed to load project");
    return res.redirect("/projects");
  }
});


/* Edit project */
router.get("/projects/:id/edit", webAuth(true), async (req, res) => {
  try {
    if (!canEditProject(res.locals.user?.role)) {
      req.flash("error", "Forbidden");
      return res.redirect(`/projects/${req.params.id}`);
    }
    const project = await Project.findById(req.params.id).select(
      "name description"
    );
    if (!project) {
      req.flash("error", "Project not found");
      return res.redirect("/projects");
    }
    res.render("projects/edit", { project, form: null });
  } catch (e) {
    req.flash("error", "Failed to open edit page");
    res.redirect("/projects");
  }
});

router.post(
  "/projects/:id/delete",
  webAuth(true),
  webRbac("admin"), // optional: require admin/superadmin for the web UI. Remove if you want owner-based rules.
  async (req, res) => {
    try {
      // call API DELETE (api helper handles AT cookie + refresh)
      await api(req, res, {
        url: `${BASE}/api/projects/${req.params.id}`,
        method: "DELETE",
      });

      req.flash("success", "Project deleted successfully");
      return res.redirect("/projects");
    } catch (e) {
      console.error(
        "Project delete failed:",
        e.response?.status,
        e.response?.data || e.message
      );
      const msg = e.response?.data?.message || "Failed to delete project";
      req.flash("error", msg);
      return res.redirect("/projects");
    }
  }
);

router.post("/projects/:id/edit", webAuth(true), async (req, res) => {
  try {
    if (!canEditProject(res.locals.user?.role)) {
      req.flash("error", "Forbidden");
      return res.redirect(`/projects/${req.params.id}`);
    }
    const { name, description } = req.body;
    const updated = await Project.findByIdAndUpdate(
      req.params.id,
      { name, description },
      { new: true }
    );
    if (!updated) {
      req.flash("error", "Project not found");
      return res.redirect("/projects");
    }
    req.flash("success", "Project updated");
    res.redirect(`/projects/${req.params.id}`);
  } catch (e) {
    req.flash("error", "Update failed");
    res.redirect(`/projects/${req.params.id}/edit`);
  }
});

// router.get("/projects/:id/add_members",webAuth(true),(req,res)=>{
//   res.render("projects/members")})

// ✅ GET: Render the "Add/Remove Members" page
// router.get("/projects/:id/add_members", webAuth(true), async (req, res) => {
//   try {
//     const project = await Project.findById(req.params.id)
//       .populate({
//         path: "managers",
//         select: "name email role",
//         populate: { path: "role", select: "name" },
//       })
//       .populate({
//         path: "members",
//         select: "name email role",
//         populate: { path: "role", select: "name" },
//       })
//       .lean();

//     if (!project) {
//       req.flash("error", "Project not found");
//       return res.redirect("/projects");
//     }

//     // ✅ Pass full project to EJS
//     res.render("projects/members", { project });
//   } catch (err) {
//     console.error("Error loading add_members page:", err);
//     req.flash("error", "Failed to load members page");
//     res.redirect("/projects");
//   }
// });

router.get("/projects/:id/add_members", webAuth(true), async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate({
        path: "managers",
        select: "name email role",
        populate: { path: "role", select: "name" },
      })
      .populate({
        path: "members",
        select: "name email role",
        populate: { path: "role", select: "name" },
      })
      .lean();

    if (!project) {
      req.flash("error", "Project not found");
      return res.redirect("/projects");
    }

    const me = res.locals.user;
    const role = (me?.role || "").toLowerCase();
    const ownerId =
      project.owner && typeof project.owner === "object"
        ? String(project.owner._id || project.owner)
        : String(project.owner || "");

    const isOwner = ownerId && ownerId === String(me.id);
    const canManageMembers = role === "superadmin" || isOwner;

    if (!canManageMembers) {
      req.flash(
        "error",
        "Only project owner or Super Admin can manage project members"
      );
      return res.redirect(`/projects/${req.params.id}`);
    }

    return res.render("projects/members", { project });
  } catch (err) {
    console.error("Error loading add_members page:", err);
    req.flash("error", "Failed to load members page");
    return res.redirect("/projects");
  }
});


// ---------- WEB: project members management (forms submit here) ----------
// add this near your other project web routes (index.web.js)

// POST /projects/:id/members/add-manager
router.post(
  "/projects/:id/members/add-manager",
  webAuth(true),
  async (req, res) => {
    try {
      const projectId = req.params.id;
      const { email } = req.body;
      if (!email) {
        req.flash("error", "Please provide an email");
        return res.redirect(`/projects/${projectId}/add_members`);
      }

      // find user
      const user = await User.findOne({ email }).populate("role", "name");
      if (!user) {
        req.flash("error", `User not found: ${email}`);
        return res.redirect(`/projects/${projectId}/add_members`);
      }
      if ((user.role?.name || "").toLowerCase() !== "manager") {
        req.flash("error", `User ${email} is not a manager`);
        return res.redirect(`/projects/${projectId}/add_members`);
      }

      // load project and permission check: owner or superadmin
      const project = await Project.findById(projectId);
      if (!project) {
        req.flash("error", "Project not found");
        return res.redirect("/projects");
      }

      const me = res.locals.user || {};
      if (
        !(me.role === "superadmin" || String(project.owner) === String(me.id))
      ) {
        req.flash(
          "error",
          "Only project owner or Super Admin can add managers"
        );
        return res.redirect(`/projects/${projectId}/add_members`);
      }

      // add manager (idempotent)
      await Project.updateOne(
        { _id: projectId },
        { $addToSet: { managers: user._id } }
      );

      req.flash("success", `Added manager ${user.name || user.email}`);
      return res.redirect(`/projects/${projectId}/add_members`);
    } catch (err) {
      console.error("add-manager web route error:", err);
      req.flash("error", "Failed to add manager");
      return res.redirect(`/projects/${req.params.id}/add_members`);
    }
  }
);

// POST /projects/:id/members/remove
// form uses hidden input 'type' = manager|member and userId
router.post("/projects/:id/members/remove", webAuth(true), async (req, res) => {
  try {
    const projectId = req.params.id;
    const { type, userId } = req.body;
    if (!userId || !["manager", "member"].includes(type)) {
      req.flash("error", "Invalid request");
      return res.redirect(`/projects/${projectId}/add_members`);
    }

    const project = await Project.findById(projectId);
    if (!project) {
      req.flash("error", "Project not found");
      return res.redirect("/projects");
    }

    const me = res.locals.user || {};
    if (
      !(me.role === "superadmin" || String(project.owner) === String(me.id))
    ) {
      req.flash(
        "error",
        "Only project owner or Super Admin can remove members/managers"
      );
      return res.redirect(`/projects/${projectId}/add_members`);
    }

    if (type === "manager") {
      await Project.updateOne(
        { _id: projectId },
        { $pull: { managers: userId } }
      );
      req.flash("success", "Manager removed");
    } else {
      await Project.updateOne(
        { _id: projectId },
        { $pull: { members: userId } }
      );
      req.flash("success", "Member removed");
    }

    return res.redirect(`/projects/${projectId}/add_members`);
  } catch (err) {
    console.error("remove member web route error:", err);
    req.flash("error", "Failed to remove user");
    return res.redirect(`/projects/${req.params.id}/add_members`);
  }
});

// POST /projects/:id/members/add-member (add employee by email)
router.post(
  "/projects/:id/members/add-member",
  webAuth(true),
  async (req, res) => {
    try {
      const projectId = req.params.id;
      const { email } = req.body;
      if (!email) {
        req.flash("error", "Please provide an email");
        return res.redirect(`/projects/${projectId}/add_members`);
      }

      const user = await User.findOne({ email }).populate("role", "name");
      if (!user) {
        req.flash("error", `User not found: ${email}`);
        return res.redirect(`/projects/${projectId}/add_members`);
      }
      if ((user.role?.name || "").toLowerCase() !== "employee") {
        req.flash("error", `User ${email} is not an employee`);
        return res.redirect(`/projects/${projectId}/add_members`);
      }

      const project = await Project.findById(projectId);
      if (!project) {
        req.flash("error", "Project not found");
        return res.redirect("/projects");
      }
      const me = res.locals.user || {};
      if (
        !(me.role === "superadmin" || String(project.owner) === String(me.id))
      ) {
        req.flash("error", "Only project owner or Super Admin can add members");
        return res.redirect(`/projects/${projectId}/add_members`);
      }

      await Project.updateOne(
        { _id: projectId },
        { $addToSet: { members: user._id } }
      );
      req.flash("success", `Added member ${user.name || user.email}`);
      return res.redirect(`/projects/${projectId}/members`);
    } catch (err) {
      console.error("add-member web route error:", err);
      req.flash("error", "Failed to add member");
      return res.redirect(`/projects/${req.params.id}/add_members`);
    }
  }
);

router.get("/projects/:id/members", webAuth(true), async (req, res, next) => {
  try {
    const r = await axios.get(`${BASE}/api/projects/${req.params.id}/members`, {
      headers: { Cookie: req.headers.cookie || "" },
      withCredentials: true,
    });
    const data = r.data.data;
    res.render("projects/memberdetails", {
      project: data.project,
      managers: data.managers,
      members: data.members,
    });
  } catch (err) {
    next(err);
  }
});


/* =================================================
   SELF REGISTER + OTP
================================================= */
router.get("/register", (req, res) =>
  res.render("auth/register", { form: {} })
);

router.post("/register", avatarUpload.single("avatar"), async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // If body fields are missing, log for debugging
    if (!name || !email || !password) {
      console.warn("Register: missing fields", {
        name,
        email,
        password,
        "content-type": req.headers["content-type"],
      });
    }

    // If there's no file, just send JSON (simple)
    if (!req.file) {
      await axios.post(
        `${BASE}/api/auth/register`,
        { name, email, password },
        { withCredentials: true }
      );
    } else {
      // Build multipart form to forward to API
      const form = new FormData();
      form.append("name", name);
      form.append("email", email);
      form.append("password", password);

      // req.file from multer: memory storage recommended -> req.file.buffer
      form.append("avatar", req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });

      await axios.post(`${BASE}/api/auth/register`, form, {
        headers: { ...form.getHeaders() },
        maxBodyLength: Infinity,
        withCredentials: true,
      });
    }

    // keep pending email for verify page
    req.session.pendingEmail = email;
    req.flash(
      "success",
      "Registration successful. Enter the OTP sent to your email."
    );
    return res.redirect(`/verify?email=${encodeURIComponent(email)}`);
  } catch (e) {
    // log full response body if present to debug API error
    console.error(
      "Register error:",
      e.response?.status,
      e.response?.data || e.message
    );
    req.flash("error", e.response?.data?.message || "Registration failed");
    return res.redirect("/register");
  }
});

// GET: render verify page (shows email from query or session)
router.get("/verify", (req, res) => {
  // prefer session pendingEmail, fall back to ?email= query param
  const email = req.session?.pendingEmail || req.query?.email || "";
  // pass any flash messages via locals (flash middleware already does this in many apps)
  res.render("auth/verify", {
    email,
    form: {},
    error: req.flash("error")[0],
    success: req.flash("success")[0],
  });
});

// POST: submit OTP to API
router.post("/verify", async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      req.flash("error", "Please provide email and OTP.");
      return res.redirect(`/verify?email=${encodeURIComponent(email || "")}`);
    }

    // Call API to verify (your API controller expects { email, otp })
    await axios.post(
      `${BASE}/api/auth/verify`,
      { email, otp },
      { withCredentials: true }
    );

    // Mark pendingEmail done (optional)
    if (req.session) delete req.session.pendingEmail;

    req.flash("success", "Email verified — you can now login.");
    return res.redirect("/login");
  } catch (e) {
    console.error(
      "Verify OTP error:",
      e.response?.status,
      e.response?.data || e.message
    );
    // Show the API error message, or a friendly fallback
    req.flash("error", e.response?.data?.message || "Invalid or expired OTP");
    return res.redirect(
      `/verify?email=${encodeURIComponent(req.body.email || "")}`
    );
  }
});

// NOTE: keep your existing upload+toCloudinary logic here if you use it.
// (omitted for brevity since your project already handles this)

/* =================================================
   TASKS (project list, create, assign, status, delete)
================================================= */
// List tasks for a project (DB for project so managers/members are populated)
// router.get("/projects/:id/tasks", webAuth(true), async (req, res) => {
//   try {
//     const project = await Project.findById(req.params.id)
//       .populate({ path: "owner", select: "name email" })
//       .populate({
//         path: "managers",
//         select: "name email role",
//         populate: { path: "role", select: "name" },
//       })
//       .populate({
//         path: "members",
//         select: "name email role",
//         populate: { path: "role", select: "name" },
//       });

//     if (!project) {
//       req.flash("error", "Project not found");
//       return res.redirect("/projects");
//     }

//     const r = await api(req, res, {
//       url: `${BASE}/api/tasks/project/${req.params.id}`,
//       method: "GET",
//     });
//     const tasks = r.data?.data?.tasks || r.data?.data || [];
//     res.render("tasks/index", { project, tasks });
//   } catch (e) {
//     res
//       .status(500)
//       .render("errors/500", { error: e.response?.data?.message || e.message });
//   }
// });

router.get("/projects/:id/tasks", webAuth(true), async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate({ path: "owner", select: "name email" })
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

    if (!project) {
      req.flash("error", "Project not found");
      return res.redirect("/projects");
    }

    const me = res.locals.user;
    if (!canViewProject(project, me)) {
      req.flash("error", "Forbidden: you are not part of this project");
      return res.redirect("/projects");
    }

    const r = await api(req, res, {
      url: `${BASE}/api/tasks/project/${req.params.id}`,
      method: "GET",
    });

    const tasks = r.data?.data?.tasks || r.data?.data || [];
    return res.render("tasks/index", { project, tasks });
  } catch (e) {
    console.error("Project tasks error:", e);
    req.flash("error", "Failed to load project tasks");
    return res.render("tasks/index", { project: null, tasks: [] });
  }
});


// Create
router.post("/projects/:id/tasks/create", webAuth(true), async (req, res) => {
  try {
    await api(req, res, {
      url: `${BASE}/api/tasks`,
      method: "POST",
      data: {
        title: req.body.title,
        description: req.body.description,
        projectId: req.params.id,
        priority: req.body.priority || "Medium",
        dueDate: req.body.dueDate || null,
      },
    });
    req.flash("success", "Task created");
  } catch (e) {
    req.flash("error", e.response?.data?.message || "Task create failed");
  }
  res.redirect(`/projects/${req.params.id}/tasks`);
});

// Assign
router.post("/tasks/:taskId/assign", webAuth(true), async (req, res) => {
  const { userId, projectId } = req.body;
  if (!userId) {
    req.flash("error", "Please select a member to assign.");
    return res.redirect(`/projects/${projectId}/tasks`);
  }
  try {
    await api(req, res, {
      url: `${BASE}/api/tasks/${req.params.taskId}/assign`,
      method: "PUT",
      data: { userId },
    });
    req.flash("success", "Task assigned");
  } catch (e) {
    req.flash("error", e.response?.data?.message || "Assign failed");
  }
  res.redirect(`/projects/${projectId}/tasks`);
});

// Update status
router.post("/tasks/:taskId/status", webAuth(true), async (req, res) => {
  const { projectId, status } = req.body;
  try {
    await api(req, res, {
      url: `${BASE}/api/tasks/${req.params.taskId}/status`,
      method: "PUT",
      data: { status },
    });
    req.flash("success", "Status updated");
  } catch (e) {
    req.flash("error", e.response?.data?.message || "Status update failed");
  }
  res.redirect(`/projects/${projectId}/tasks`);
});

// Delete (fixed param name)
router.post("/tasks/:taskId/delete", webAuth(true), async (req, res) => {
  try {
    await api(req, res, {
      url: `${BASE}/api/tasks/${req.params.taskId}`,
      method: "DELETE",
    });
    req.flash("success", "Task deleted");
  } catch (e) {
    req.flash("error", e.response?.data?.message || "Delete failed");
  }
  res.redirect(`/projects/${req.body.projectId}/tasks`);
});

// My Tasks (employee) — uses api() so refresh works
router.get("/tasks/my", webAuth(true), async (req, res) => {
  try {
    const r = await api(req, res, {
      url: `${BASE}/api/tasks/my`,
      method: "GET",
    });
    const tasks = Array.isArray(r.data?.data) ? r.data.data : [];
    res.render("tasks/my", { tasks });
  } catch (e) {
    const msg =
      e.response?.data?.message || e.message || "Failed to load tasks";
    req.flash("error", msg);
    res.render("tasks/my", { tasks: [] });
  }
});

/* =================================================
   TASK DETAILS (SSR)
================================================= */
router.get("/tasks/:id", webAuth(true), async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate({ path: "assignedTo", select: "name email" })
      .populate({ path: "createdBy", select: "name email" })
      .populate({ path: "comments.by", select: "name email" })
      .lean();

    if (!task) {
      req.flash("error", "Task not found");
      return res.redirect("/projects");
    }

    const project = await Project.findById(task.projectId)
      .populate({ path: "owner", select: "name email" })
      .lean();

    if (!project) {
      req.flash("error", "Project not found for task");
      return res.redirect("/projects");
    }

    const role = (res.locals.user?.role || "").toLowerCase();
    const meId = res.locals.user?.id || "";
    const canManage =
      role === "superadmin" ||
      role === "admin" ||
      String(project.owner) === String(meId) ||
      (Array.isArray(project.managers) &&
        project.managers.some((id) => String(id) === String(meId)));

    return res.render("tasks/show", { task, project, canManage, meId });
  } catch (e) {
    console.error("Task details error:", e);
    req.flash("error", "Failed to load task");
    return res.redirect("/projects");
  }
});
// Show form to edit a task
router.get("/tasks/:id/edit", webAuth(true), async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate({ path: "assignedTo", select: "name email" })
      .populate({ path: "createdBy", select: "name email" })
      .lean();

    if (!task) {
      req.flash("error", "Task not found");
      return res.redirect("/projects");
    }

    const project = await Project.findById(task.projectId).lean();

    if (!project) {
      req.flash("error", "Project not found for task");
      return res.redirect("/projects");
    }

    const role = (res.locals.user?.role || "").toLowerCase();
    const meId = res.locals.user?.id || "";
    // Re-implement the canManage logic from task details
    const canManage =
      role === "superadmin" ||
      role === "admin" ||
      String(project.owner) === String(meId) ||
      (Array.isArray(project.managers) &&
        project.managers.some((id) => String(id) === String(meId)));

    // Check if user is the creator OR can manage the project
    const isCreator = String(task.createdBy._id) === String(meId);
    if (!(isCreator || canManage)) {
      req.flash("error", "Not authorized to edit this task.");
      return res.redirect(`/tasks/${req.params.id}`);
    }

    return res.render("tasks/edit", { task, project, members: [] }); // You might want to fetch project members here for 'assignedTo' dropdown later
  } catch (e) {
    console.error("Task edit form error:", e);
    req.flash("error", "Failed to load task edit form");
    return res.redirect("/projects");
  }
});

// Update a task
router.post("/tasks/:id/update", webAuth(true), async (req, res) => {
  const { title, description, priority, dueDate } = req.body;

  try {
    const r = await api(req, res, {
      url: `${BASE}/api/tasks/${req.params.id}`,
      method: "PUT", // Use PUT to match your API route
      data: {
        title,
        description,
        priority,
        dueDate: dueDate || null,
      },
    });

    // Get the projectId to redirect back to the task list/details
    const projectId = r.data.data.projectId || req.body.projectId; // Assuming API response includes projectId

    req.flash("success", "Task updated successfully");
    return res.redirect(`/tasks/${req.params.id}`); // Redirect to task details page
  } catch (e) {
    const projectId = req.body.projectId; // Ensure you pass projectId in the form for error redirects
    req.flash("error", e.response?.data?.message || "Task update failed");
    return res.redirect(`/tasks/${req.params.id}/edit?projectId=${projectId}`); // Redirect back to edit form on failure
  }
});

/* =================================================
   COMMENTS & ATTACHMENTS (SSR -> API)
================================================= */
// Single-file upload for attachment proxy

// Helper to build auth headers
const authHeaders = (req) => {
  const at = req.signedCookies.AT || req.cookies.AT;
  return {
    Authorization: `Bearer ${at}`,
    Cookie: req.headers.cookie || "",
  };
};

// Add comment (text only)
router.post(
  "/tasks/:taskId/comments",
  attachmentUpload.array("files", 5),
  webAuth(true),
  async (req, res) => {
    const { taskId } = req.params;
    try {
      const form = new FormData();
      form.append("text", req.body?.text || "");

      if (req.files?.length) {
        req.files.forEach((file) => {
          form.append("files", file.buffer, {
            filename: file.originalname,
            contentType: file.mimetype,
          });
        });
      }

      await axios.post(`${BASE}/api/tasks/${taskId}/comments`, form, {
        headers: { ...form.getHeaders(), ...authHeaders(req) },
        withCredentials: true,
      });
      req.flash("success", "Comment added");
    } catch (e) {
      console.error(
        "comment add fail:",
        e.response?.status,
        e.response?.data || e.message
      );
      req.flash("error", e.response?.data?.message || "Failed to add comment");
    }
    res.redirect(`/tasks/${taskId}`);
  }
);

// Delete comment
router.post(
  "/tasks/:taskId/comments/:commentId/delete",
  webAuth(true),
  async (req, res) => {
    const { taskId, commentId } = req.params;
    try {
      await api(req, res, {
        url: `${BASE}/api/tasks/${taskId}/comments/${commentId}`,
        method: "DELETE",
      });
      req.flash("success", "Comment deleted");
    } catch (e) {
      console.error(
        "comment delete fail:",
        e.response?.status,
        e.response?.data || e.message
      );
      req.flash(
        "error",
        e.response?.data?.message || "Failed to delete comment"
      );
    }
    res.redirect(`/tasks/${taskId}`);
  }
);

// Add attachment (multipart proxy -> API)
router.post(
  "/tasks/:taskId/attachments",
  webAuth(true),

  attachmentUpload.single("file"), // ✅ unified uploader
  async (req, res) => {
    const { taskId } = req.params;

    if (!req.file) {
      req.flash("error", "No file uploaded");
      return res.redirect(`/tasks/${taskId}`);
    }

    try {
      const form = new FormData();
      form.append("file", req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });

      await axios.post(`${BASE}/api/tasks/${taskId}/attachments`, form, {
        headers: { ...authHeaders(req), ...form.getHeaders() },
        maxBodyLength: Infinity,
        withCredentials: true,
      });

      req.flash("success", "Attachment added");
    } catch (e) {
      console.error(
        "attachment add fail:",
        e.response?.status,
        e.response?.data || e.message
      );
      req.flash(
        "error",
        e.response?.data?.message || "Failed to add attachment"
      );
    }
    res.redirect(`/tasks/${taskId}`);
  }
);

// Delete attachment
// captures slashes in publicId using a wildcard segment
// app/routes/web/index.web.js

// In your web route or wherever you're calling this
router.post(
  "/tasks/:taskId/attachments/delete",
  webAuth(true),
  async (req, res) => {
    const { taskId } = req.params;
    let { publicId } = req.body;

    if (!publicId) {
      req.flash("error", "Missing publicId");
      return res.redirect(`/tasks/${taskId}`);
    }

    // URL encode if it contains slashes
    const encodedPublicId = encodeURIComponent(publicId);

    try {
      const at = req.signedCookies.AT || req.cookies.AT;

      await axios.post(
        `${BASE}/api/tasks/${taskId}/attachments/delete`,
        { publicId: encodedPublicId }, // Send encoded in body
        {
          headers: {
            Authorization: `Bearer ${at}`,
            Cookie: req.headers.cookie || "",
          },
          withCredentials: true,
        }
      );

      req.flash("success", "Attachment removed");
    } catch (e) {
      console.error(
        "Attachment delete fail:",
        e.response?.status,
        e.response?.data || e.message
      );
      req.flash(
        "error",
        e.response?.data?.message || "Failed to remove attachment"
      );
    }

    return res.redirect(`/tasks/${taskId}`);
  }
);

/* =================================================
   CHAT (SSR)
================================================= */
// Pass user context and a default room so your front-end can call socket.identify()
// router.get("/chat", webAuth(true), (req, res) => {
//   // full user object for sidebar and chat bot
//  const me= res.locals.me || {};
//  const user=me;

//   res.render("chat/index", {
//     room: "global",
//       id: user.id,
//       name: user.name,
//       role: user.role,
//       email: user.email,

//     user, // ✅ pass same user to layout (so sidebar keeps working)
//   });
// });

router.get("/chat", webAuth(true), async (req, res) => {
  const me = res.locals.me || res.locals.user || {};
  const projects = await Project.find({
    $or: [{ owner: me.id }, { managers: me.id }, { members: me.id }],
  })
    .select("name")
    .lean();
  res.render("chat/index", {
    room: "global",
    me: {
      id: me.id,
      name: me.name,
      role: me.role,
      email: me.email,
      avatar: me.avatar,
    },
    projects: projects || [],
  });
});

/* ====================== Profile (SSR) ====================== */
// View profile page
router.get("/profile", webAuth(true), profileCtrl.getProfile);

// Change avatar (multipart form: name="avatar")
router.post(
  "/profile/avatar",
  webAuth(true),
  avatarUpload.single("avatar"),
  profileCtrl.updateAvatar
);

// Update basic fields (e.g., name)
router.post("/profile", webAuth(true), profileCtrl.updateBasic);

module.exports = router;
