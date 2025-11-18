// services/socketAuth.js
const cookie = require('cookie');
const jwt = require('jsonwebtoken');

module.exports = (socket, next) => {
  try {
    const headers = socket.handshake.headers || {};
    const cookies = headers.cookie ? cookie.parse(headers.cookie || '') : {};
    const tokenFromCookie = cookies.token || cookies.jwt || null; // adapt name(s) if you use different cookie name
    const tokenFromAuth = socket.handshake.auth && socket.handshake.auth.token;

    const token = tokenFromAuth || tokenFromCookie;
    if (!token) {
      // No token - set guest user or reject connection:
      // return next(new Error('unauthorized')); // uncomment if you want to block unauthenticated sockets
      socket.data.user = { id: null, name: 'Guest', role: 'guest' };
      return next();
    }

    const secret = process.env.JWT_ACCESS_SECRET || 'change-this'; // set JWT_SECRET in env in production
    const payload = jwt.verify(token, secret);

    // keep only minimal user object (do NOT put sensitive data here)
    socket.data.user = {
      id: payload.id || payload._id || payload.userId,
      name: payload.name || payload.email || payload.username || 'User',
      role: payload.role || 'user',
      email: payload.email
    };
    return next();
  } catch (err) {
    console.error('socket auth error', err.message);
    // Option: reject connection:
    // return next(new Error('unauthorized'));
    // Or allow as guest:
    socket.data.user = { id: null, name: 'Guest', role: 'guest' };
    return next();
  }
};
