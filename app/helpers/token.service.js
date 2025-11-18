const jwt=require("jsonwebtoken");
const crypto = require('crypto');
const RefreshToken = require('../models/RefreshToken.model');

const ACCESS_TTL = process.env.JWT_ACCESS_EXPIRES || '15m';
const REFRESH_DAYS = parseInt(process.env.REFRESH_COOKIE_EXPIRES_DAYS || '7', 10);

function signAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}

function generateRawRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function issueRefreshToken(userId, meta = {}) {
  const raw = generateRawRefreshToken();
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);
  await RefreshToken.create({
    user: userId,
    tokenHash,
    userAgent: meta.userAgent,
    ip: meta.ip,
    expiresAt
  });
  return { raw, expiresAt };
}
// async function issueRefreshToken(userId, meta = {}) {
//   const raw = generateRawRefreshToken();
//   const tokenHash = hashToken(raw);
//   const expiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);
//   await RefreshToken.create({
//     user: userId,
//     tokenHash,
//     userAgent: meta.userAgent,
//     ip: meta.ip,
//     expiresAt
//   });
//   return { raw, expiresAt };
// }

async function rotateRefreshToken(oldRaw, userId, meta = {}) {
  const oldHash = hashToken(oldRaw);
  const existing = await RefreshToken.findOne({ user: userId, tokenHash: oldHash, isRevoked: false });
  if (!existing || existing.expiresAt < new Date()) throw new Error('Invalid refresh token');

  // revoke old
  //existing.isRevoked = true;
  const { raw: newRt } = await issueRefreshToken(userId, meta);
  existing.expiresAt = new Date(Date.now() + 30 * 1000)
  await existing.save();
return { raw: newRt, expiresAt: newRt.expiresAt };
  // issue new
  //return issueRefreshToken(userId, meta);
}
async function revokeRefreshToken(raw, userId) {
  const tokenHash = hashToken(raw);
  await RefreshToken.updateOne({ user: userId, tokenHash }, { $set: { isRevoked: true } });
}

function refreshCookieOptions() {
  const days = REFRESH_DAYS;
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    signed: !!process.env.COOKIE_SECRET,
    maxAge: days * 24 * 60 * 60 * 1000,
    path: '/'  
  };
}
module.exports = {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  refreshCookieOptions,
  hashToken
};