require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
// const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const path = require("path");
const session = require("express-session");
const flash = require("connect-flash");
const expressLayouts = require("express-ejs-layouts");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const signature = require("cookie-signature");
const cookie = require("cookie");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
/* ------------ DB & Models ------------ */
const connectDb = require("./app/config/db");
const seedRoles = require("./app/config/seedRole");
const seedSuperAdmin = require("./app/config/seedSuperAdmin");
const routes = require("./app/routes/index");
const User = require("./app/models/User.model");
const attachBotToSocket = require("./app/services/bot.service");

/* ------------ App & Server ------------ */
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
app.use(cors({ origin: true, credentials: true }));

/* ===========================================
   SOCKET.IO: auth + rooms + bot registration
   =========================================== */

/** tiny cookie parser for handshake headers */
// function getCookieFromHeader(header = "", name = "") {
//   const rx = new RegExp(`(?:^|; )${name}=([^;]*)`);
//   const m = header.match(rx);
//   return m ? decodeURIComponent(m[1]) : null;
// }

function getCookieFromHeader(header = "", name = "") {
  const rx = new RegExp(`(?:^|; )${name}=([^;]*)`);
  const m = header.match(rx);
  if (!m) return null;
  let val = decodeURIComponent(m[1]);
  // Express signed cookies appear as "s:VALUE.sig" when read raw; strip "s:" prefix if present.
  if (val.startsWith("s:")) {
    val = val.slice(2);
  }
  return val || null;
}

/** Socket auth: read AT from cookies -> verify -> socket.user */

// io.use((socket, next) => {
//   try {
//     // 1) support explicit token via websocket auth (io({ auth: { token } }))
//     const tokenFromAuth = socket.handshake?.auth?.token;
//     if (tokenFromAuth) {
//       try {
//         const payload = jwt.verify(tokenFromAuth, process.env.JWT_ACCESS_SECRET);
//         socket.user = { id: String(payload.sub || payload.id), role: payload.role, name: payload.name, email: payload.email };
//         console.debug('[io.use] attached socket.user from handshake.auth ->', socket.user.id);
//         return next();
//       } catch (err) {
//         console.debug('[io.use] auth.token verify failed:', err.message);
//         // fallthrough to cookie method
//       }
//     }

//     // 2) try cookie header (older approach / default)
//     const cookieHeader = socket.handshake.headers?.cookie || "";

//     if (!cookieHeader) {
//       console.debug('[io.use] no cookies - guest mode');
//       return next();
//     }

//     const at = getCookieFromHeader(cookieHeader, "AT");
//     console.debug('[io.use] handshake.cookies present?', !!cookieHeader, 'AT present?', !!at);

//     if (at) {
//       try {
//         const payload = jwt.verify(at, process.env.JWT_ACCESS_SECRET);
//         socket.user = { id: String(payload.sub || payload.id), role: payload.role, name: payload.name, email: payload.email };
//         console.debug('[io.use] attached socket.user ->', socket.user.id);
//         return next();
//       } catch (err) {
//         // token present but invalid/expired
//         console.debug('[io.use] AT verify failed:', err.message);
//         // allow connection as guest (or choose to next(new Error('unauthorized')))
//         return next();
//       }
//     }

//     // no token found
//     console.debug('[io.use] no AT - socket will be unauthenticated (guest)');
//     return next();
//   } catch (err) {
//     console.debug('[io.use] unexpected error:', err.message);
//     return next();
//   }
// });

io.use((socket, next) => {
  try {
    // 1) Try explicit token from handshake auth
    const tokenFromAuth = socket.handshake?.auth?.token;
    if (tokenFromAuth) {
      try {
        const payload = jwt.verify(
          tokenFromAuth,
          process.env.JWT_ACCESS_SECRET
        );
        socket.user = {
          id: String(payload.sub || payload.id),
          role: payload.role,
          name: payload.name,
          email: payload.email,
        };
        console.debug("[io.use] authenticated via handshake.auth");
        return next();
      } catch (err) {
        console.debug("[io.use] auth.token verify failed:", err.message);
      }
    }

    // 2) Try cookie header
    const cookieHeader = socket.handshake.headers?.cookie || "";
    if (!cookieHeader) {
      console.debug("[io.use] no cookies - guest mode");
      return next();
    }

    const cookies = cookie.parse(cookieHeader);
    let token = cookies.AT;

    if (!token) {
      console.debug("[io.use] no AT cookie - guest mode");
      return next();
    }

    // Handle signed cookie if it starts with 's:'
    if (token.startsWith("s:")) {
      token = signature.unsign(token.slice(2), process.env.COOKIE_SECRET);
      if (token === false) {
        console.debug("[io.use] cookie signature invalid");
        return next();
      }
    }

    // Verify JWT
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    socket.user = {
      id: String(payload.sub || payload.id),
      role: payload.role,
      name: payload.name,
      email: payload.email,
    };
    console.debug("[io.use] authenticated via cookie - user:", socket.user.id);
    return next();
  } catch (err) {
    console.debug("[io.use] error:", err.message);
    return next(); // Allow as guest
  }
});

/** Base room wiring (kept minimal; bot will handle commands/events) */
io.on("connection", (socket) => {
  // auto-join user and role rooms if authenticated
  if (socket.user?.id) socket.join(`user:${socket.user.id}`);
  if (socket.user?.role)
    socket.join(`role:${String(socket.user.role).toLowerCase()}`);

  // clients can also join project rooms like 'project:<id>'
  socket.on("join", (room) => {
    if (typeof room === "string" && room.length) socket.join(room);
  });

  // OPTIONAL: typing indicators (nice UX)
  socket.on("chat:typing", (room) => {
    if (typeof room === "string")
      socket.to(room).emit("chat:typing", { room, at: Date.now() });
  });
  socket.on("chat:stop_typing", (room) => {
    if (typeof room === "string")
      socket.to(room).emit("chat:stop_typing", { room, at: Date.now() });
  });

  if (socket.user?.id) socket.join(`user:${socket.user.id}`);
  if (socket.user?.role)
    socket.join(`role:${String(socket.user.role).toLowerCase()}`);

  // optional: join global by default
  socket.join("global");

  // Attach bot handlers for this socket
  attachBotToSocket(io, socket);
});

/** Register the chatbot (all logic lives here) */
// const registerChat = require("./app/services/bot.service");
// registerChat(io);

// Expose io to controllers (e.g., task status emit)
app.set("io", io);

/* ==========================
   CONNECT DB + seed defaults
   ========================== */
connectDb().then(async () => {
  await seedRoles();
  await seedSuperAdmin();
});

/* ==========================
   Express core middleware
   ========================== */
app.set("trust proxy", 1);
app.use(expressLayouts);
app.set("layout", "layout");
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "./views"));
app.use(express.static(path.join(__dirname, "./public")));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
// app.use(helmet());
app.use(morgan("dev"));
app.use(cookieParser(process.env.COOKIE_SECRET));

/* ==========================
   API routes (rate-limited)
   ========================== */
app.use("/api", rateLimit({ windowMs: 60 * 1000, max: 60 }), routes);

/* ==========================
   Swagger UI (docs) - minimal add
   ========================== */

function mergeYamlFiles() {
  const mainDoc = YAML.load(path.join(__dirname, "swagger/openapi.yaml"));
  const files = mainDoc["x-paths"];

  if (files) {
    mainDoc.paths = {};
    for (const key in files) {
      const refPath = path.join(__dirname, "swagger", files[key]);
      if (fs.existsSync(refPath)) {
        const subDoc = YAML.load(refPath);
        Object.assign(mainDoc.paths, subDoc.paths || {});
      }
    }
    delete mainDoc["x-paths"];
  }

  return mainDoc;
}

const swaggerDocument = mergeYamlFiles();
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

/* ============================================
   Sessions + flash (for EJS SSR-only features)
   ============================================ */
app.use(
  session({
    secret: process.env.SESSION_SECRET || "super-secret-session",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 30, // 30 min
    },
  })
);
app.use(flash());
app.use((req, res, next) => {
  res.locals.flash = {
    success: req.flash("success"),
    error: req.flash("error"),
    info: req.flash("info"),
    warn: req.flash("warn"),
  };
  next();
});

/* ============================================
   SSR auth helper — hydrate res.locals.user
   ============================================ */
const webAuth = require("./app/middlewares/webAuth"); // parses AT/refresh and sets req.webUser
app.use(webAuth(false));

app.use(async (req, res, next) => {
  try {
    if (req.webUser && !res.locals.user?.email) {
      const u = await User.findById(req.webUser.id)
        .select("name email avatar role")
        .populate("role", "name");
      if (u) {
        res.locals.user = {
          id: String(u._id),
          name: u.name,
          email: u.email,
          role: u.role?.name,
          avatar: u.avatar,
        };
      }
    }
  } catch (err) {
    console.log("Sidebar user inject error:", err.message);
  }
  next();
});

app.use((req, res, next) => {
  res.locals.path = req.path || "";
  next();
});

/* ==========================
   SSR routes
   ========================== */
app.use("/", require("./app/routes/web/index.web"));

/* ==========================
   Error handler
   ========================== */
app.use((err, req, res, next) => {
  console.error("ERROR:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Server Error",
  });
});

/* ==========================
   Start server
   ========================== */
//app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
