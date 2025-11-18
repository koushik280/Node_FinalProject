const jwt = require("jsonwebtoken");
// module.exports = function auth(required = true) {
//   return (req, res, next) => {
//     const header = req.headers.authorization || "";
//     const token = header.startsWith("Bearer ") ? header.slice(7) : null;
//     if (!token)
//       return required
//         ? res.status(401).json({ success: false, message: "Unauthorized" })
//         : next();
//     try {
//       const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
//       req.user = {
//         id: payload.sub || payload.id,
//         role: payload.role,
//         name: payload.name,
//         email: payload.email,
//       };
//       if (token && res.locals) {
//         res.locals.accessToken = token;
//       }

//       console.debug('[auth] authenticated user:', req.user.id, req.user.role);
//       next();
//     } catch (e) {
//       console.debug('[auth] token verification failed:', err.message);
//       if (!required) return next();
//       return res.status(401).json({ success: false, message: "Invalid token" });
//     }
//   };
// };


// app/middlewares/auth.js
//const jwt = require('jsonwebtoken');

module.exports = function auth(required = true) {
  return (req, res, next) => {
    try {
      // 1) Authorization header (preferred)
      const header = req.headers.authorization || '';
      const tokenFromHeader = header.startsWith('Bearer ') ? header.slice(7) : null;

      // 2) Signed cookie (if cookieParser(secret) is used)
      const tokenFromSignedCookie = req.signedCookies?.AT || null;

      // 3) Unsigned cookie fallback
      const tokenFromCookie = req.cookies?.AT || null;

      const token = tokenFromHeader || tokenFromSignedCookie || tokenFromCookie;

      if (!token) {
        if (!required) return next();
        console.debug('[auth] no token provided (header/cookie).');
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      // verify using same secret used to sign access tokens
      const secret = process.env.JWT_ACCESS_SECRET;
      if (!secret) {
        console.error('[auth] JWT_ACCESS_SECRET not set in env!');
        if (!required) return next();
        return res.status(500).json({ success: false, message: 'Server misconfiguration' });
      }

      const payload = jwt.verify(token, secret);

      req.user = {
        id: payload.sub || payload.id || payload.userId,
        role: payload.role,
        name: payload.name,
        email: payload.email,
      };

      // expose token to templates if useful
      if (res.locals) res.locals.accessToken = token;

      console.debug('[auth] authenticated user:', req.user.id, req.user.role, 'via', tokenFromHeader ? 'header' : (tokenFromSignedCookie ? 'signedCookie' : 'cookie'));
      return next();
    } catch (err) {
      console.debug('[auth] token verification failed:', err && err.message);
      if (!required) return next();
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
  };
};
