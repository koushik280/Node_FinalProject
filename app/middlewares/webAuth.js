// app/middlewares/webAuth.js
const jwt = require("jsonwebtoken");
const axios = require("axios");

const BASE =
  process.env.WEB_API_BASE || `http://localhost:${process.env.PORT || 5000}`;

function setATCookie(res, at) {
  res.cookie("AT", at, {
    httpOnly: true,
    signed: !!process.env.COOKIE_SECRET,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 15 * 60 * 1000,
    path:"/"
  });
}

async function fetchMe(headers) {
  const r = await axios.get(`${BASE}/api/users/me`, {
    headers,
    withCredentials: true,
  });
  return r.data?.data;
}

function attachUser(req, res, payload, token) {
  const u = {
    id: String(payload.sub || payload.id || ""),
    role: payload.role,
    name: payload.name,
    email: payload.email,
  };
  req.webUser = u;
  req.user = u;
  res.locals.user = u;
  res.locals.accessToken = token;

  console.debug(
    `[webAuth] attached user -> id:${u.id} role:${u.role} name:${u.name || "-"}`
  );
}

// allow these paths even when passwordMustChange is true
function isAllowedWhenMustChange(path) {
  if (!path) return false;
  const p = path.toLowerCase();
  // allow change-password page, logout, static assets, and api/auth endpoints
  if (p.startsWith("/profile/change-password")) return true;
  if (p.startsWith("/logout")) return true;
  if (p.startsWith("/assets") || p.startsWith("/public") || p.startsWith("/static")) return true;
  // allow api endpoints that auth layer might need (optional)
  if (p.startsWith("/api/auth")) return true;
  return false;
}

module.exports = function webAuth(required = true) {
  return async (req, res, next) => {
    const at = req.signedCookies?.AT || req.cookies?.AT;
    console.debug("[webAuth] cookie AT present?", !!at);

    if (at) {
      try {
        const payload = jwt.verify(at, process.env.JWT_ACCESS_SECRET);
        attachUser(req, res, payload, at);

        // load full user (with avatar & flags) for views
        try {
          const me = await fetchMe({
            Authorization: `Bearer ${at}`,
            Cookie: req.headers.cookie || "",
          });
          if (me) {
            res.locals.me = me;
            console.debug(
              "[webAuth] fetched full me for views:",
              me.email || me.name || me.id
            );

            // Forced password change check
            if (me.passwordMustChange && required && !isAllowedWhenMustChange(req.path)) {
              console.debug("[webAuth] user must change password -> redirecting", req.path);
              return res.redirect("/profile/change-password");
            }
          }
        } catch (fetchErr) {
          console.debug("[webAuth] fetchMe error:", fetchErr.message || fetchErr);
          // continue — we'll allow refresh below if available
        }

        return next();
      } catch (err) {
        console.debug("[webAuth] verify AT failed:", err.message);
        /* try refresh below */
      }
    }

    // Try refresh flow
    try {
      const r = await axios.post(
        `${BASE}/api/auth/refresh`,
        {},
        {
          withCredentials: true,
          headers: { Cookie: req.headers.cookie || "" },
        }
      );
      const newAT = r.data?.data?.accessToken;
      if (newAT) {
        const setCookie = r.headers["set-cookie"];
        if (setCookie && setCookie.length) {
          res.setHeader("Set-Cookie", setCookie);
        }
        setATCookie(res, newAT);
        const payload = jwt.verify(newAT, process.env.JWT_ACCESS_SECRET);
        attachUser(req, res, payload, newAT);

        // fetch full me after refresh
        try {
          const me = await fetchMe({
            Authorization: `Bearer ${newAT}`,
            Cookie: req.headers.cookie || "",
          });
          if (me) {
            res.locals.me = me;
            console.debug("[webAuth] refreshed AT and fetched full me:", me.email || me.id);

            if (me.passwordMustChange && required && !isAllowedWhenMustChange(req.path)) {
              console.debug("[webAuth] (after refresh) user must change password -> redirecting", req.path);
              return res.redirect("/profile/change-password");
            }
          }
        } catch (fetchErr) {
          console.debug("[webAuth] fetchMe after refresh failed:", fetchErr.message || fetchErr);
        }

        return next();
      }
    } catch (err) {
      console.debug("[webAuth] refresh failed:", err.message || err.toString());
    }

    if (!required) return next();
    return res.redirect("/login");
  };
};
