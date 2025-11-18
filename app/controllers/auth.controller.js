// app/controllers/auth.controller.js
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User.model");
const Role = require("../models/Role.model");
const RefreshToken = require("../models/RefreshToken.model");
const { hashToken } = require("../helpers/token.service");
const crypto = require("crypto");
const {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken, // <-- use this for single-token revoke
  refreshCookieOptions,
} = require("../helpers/token.service");
const { sendOtpMail,sendPasswordResetLink } = require("../helpers/mail.service");

function randomOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

class AuthController {
  // ------------------ SIGNUP (self-register) ------------------
  async signup(req, res, next) {
    try {
      const { name, email, password } = req.body;

      const role = await Role.findOne({ name: "employee" });
      if (!role) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid role" });
      }

      const exists = await User.findOne({ email });
      if (exists) {
        return res
          .status(409)
          .json({ success: false, message: "Email already registered" });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const otp = randomOtp();
      const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

      await User.create({
        name,
        email,
        passwordHash,
        role: role._id,
        otp: { code: otp, expiresAt: otpExpires },
        isVerified: false,
        avatar: req.body.avatar || undefined,
      });

      await sendOtpMail(email, otp);

      res.status(201).json({
        success: true,
        message: "User created. OTP sent to email.",
      });
    } catch (err) {
      next(err);
    }
  }

  // ------------------ VERIFY EMAIL (OTP) ------------------
  async verify(req, res, next) {
    try {
      const { email, otp } = req.body;
      const user = await User.findOne({ email }).populate("role");
      if (
        !user ||
        !user.otp ||
        user.otp.code !== otp ||
        user.otp.expiresAt < new Date()
      ) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid or expired OTP" });
      }

      user.isVerified = true;
      user.otp = undefined;
      await user.save();

      res.json({ success: true, message: "Email verified" });
    } catch (err) {
      next(err);
    }
  }

  // ------------------ LOGIN ------------------
  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const user = await User.findOne({ email }).populate("role");
      if (!user)
        return res
          .status(401)
          .json({ success: false, message: "Invalid credentials" });

      if (!user.isVerified)
        return res
          .status(403)
          .json({ success: false, message: "Email not verified" });

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok)
        return res
          .status(401)
          .json({ success: false, message: "Invalid credentials" });

      // Access token carries sub + role NAME (string) for RBAC checks
      const accessToken = signAccessToken({
        sub: user._id,
        role: user.role?.name,
      });

      // Persist/rotate refresh token
      const meta = { userAgent: req.get("user-agent"), ip: req.ip };
      const { raw: refreshRaw } = await issueRefreshToken(user._id, meta);

      const mustChange = user.passwordMustChange === true;

      res
        .cookie(
          process.env.REFRESH_COOKIE_NAME,
          refreshRaw,
          refreshCookieOptions()
        )
        .json({
          success: true,
          message: mustChange
            ? "Logged in. Password change required."
            : "Logged in",
          data: {
            accessToken,
            forceChangePassword: mustChange,
            user: {
              id: user._id,
              name: user.name,
              email: user.email,
              role: user.role.name,
            },
          },
        });
    } catch (err) {
      next(err);
    }
  }

  // ------------------ CHANGE PASSWORD (revoke ALL refresh tokens) ------------------
  async changePassword(req, res, next) {
    try {
      const user = await User.findById(req.user.id);
      if (!user)
        return res
          .status(404)
          .json({ success: false, message: "User not found" });

      const ok = await bcrypt.compare(req.body.oldPassword, user.passwordHash);
      if (!ok)
        return res
          .status(400)
          .json({ success: false, message: "Old password incorrect" });

      user.passwordHash = await bcrypt.hash(req.body.newPassword, 10);
      user.passwordMustChange = false;
      await user.save();

      // Revoke all active refresh tokens for this user so all other sessions die immediately
      await RefreshToken.updateMany(
        { user: user._id, isRevoked: false },
        {
          $set: {
            isRevoked: true,
            revokedAt: new Date(),
            reason: "password_change",
          },
        }
      );

      res.json({ success: true, message: "Password updated" });
    } catch (e) {
      next(e);
    }
  }

  // ------------------ REFRESH (detect reuse, rotate) ------------------
  // async refresh(req, res, next) {
  //   try {
  //     const rt =
  //       req.signedCookies?.[process.env.REFRESH_COOKIE_NAME] ||
  //       req.cookies?.[process.env.REFRESH_COOKIE_NAME];

  //     if (!rt) {
  //       console.debug('[refresh] REJECT (401): No refresh token cookie found.'); // <-- ADD THIS
  //       return res.status(401).json({ success: false, message: "No refresh token" });
  //     }

  //     // Look up refresh token doc by hash
  //     const doc = await RefreshToken.findOne({
  //       tokenHash: hashToken(rt),
  //     });

  //     // Reuse / invalid / expired → revoke-all (if we know the user), clear cookie, 401
  //     if (!doc || doc.isRevoked || doc.expiresAt < new Date()) {
  //       if (doc?.user) {
  //         await RefreshToken.updateMany(
  //           { user: doc.user, isRevoked: false },
  //           { $set: { isRevoked: true, revokedAt: new Date(), reason: "suspected_reuse" } }
  //         );
  //       }
  //       res.clearCookie(process.env.REFRESH_COOKIE_NAME, refreshCookieOptions());
  //       return res.status(401).json({ success: false, message: "Invalid refresh token" });
  //     }

  //     const user = await User.findById(doc.user).populate("role");
  //     if (!user) {
  //       // If user is gone, revoke this token and clear cookie
  //       await revokeRefreshToken(rt);
  //       res.clearCookie(process.env.REFRESH_COOKIE_NAME, refreshCookieOptions());
  //       return res.status(401).json({ success: false, message: "User not found" });
  //     }

  //     const accessToken = signAccessToken({ sub: user._id, role: user.role.name });

  //     // Rotate refresh token atomically
  //     const { raw: newRt } = await rotateRefreshToken(rt, user._id, {
  //       userAgent: req.get("user-agent"),
  //       ip: req.ip,
  //     });

  //     res
  //       .cookie(process.env.REFRESH_COOKIE_NAME, newRt, refreshCookieOptions())
  //       .json({ success: true, data: { accessToken } });
  //   } catch (err) {
  //     next(err);
  //   }
  // }

  async refresh(req, res, next) {
    try {
      const rt =
        req.signedCookies?.[process.env.REFRESH_COOKIE_NAME] ||
        req.cookies?.[process.env.REFRESH_COOKIE_NAME];

      // LOG 1: Check if the cookie was received
      if (!rt) {
        console.debug("[refresh] REJECT (401): No refresh token cookie found.");
        return res
          .status(401)
          .json({ success: false, message: "No refresh token" });
      }

      // Look up refresh token doc by hash
      const doc = await RefreshToken.findOne({
        tokenHash: hashToken(rt),
      });

      // LOG 2: Check if the token is valid in the database
      if (!doc || doc.isRevoked || doc.expiresAt < new Date()) {
        let reason = "not_found";
        if (doc?.isRevoked) reason = "revoked";
        if (doc && doc.expiresAt < new Date()) reason = "expired";
        console.debug(
          `[refresh] REJECT (401): Invalid refresh token. Reason: ${reason}`
        );

        // ... (rest of the revoke logic) ...
        if (doc?.user) {
          await RefreshToken.updateMany(
            { user: doc.user, isRevoked: false },
            {
              $set: {
                isRevoked: true,
                revokedAt: new Date(),
                reason: "suspected_reuse",
              },
            }
          );
        }
        res.clearCookie(
          process.env.REFRESH_COOKIE_NAME,
          refreshCookieOptions()
        );
        return res
          .status(401)
          .json({ success: false, message: "Invalid refresh token" });
      }

      // LOG 3: Check if the user associated with the token still exists
      const user = await User.findById(doc.user).populate("role");
      if (!user) {
        console.debug(
          "[refresh] REJECT (401): User not found for valid token."
        );
        await revokeRefreshToken(rt); // Use your existing utility function
        res.clearCookie(
          process.env.REFRESH_COOKIE_NAME,
          refreshCookieOptions()
        );
        return res
          .status(401)
          .json({ success: false, message: "User not found" });
      }

      // LOG 4: Success case
      console.debug(
        "[refresh] SUCCESS: Issuing new AT and rotating RT for user:",
        user._id
      );

      const accessToken = signAccessToken({
        sub: user._id,
        role: user.role.name,
      });

      // Rotate refresh token atomically
      const { raw: newRt } = await rotateRefreshToken(rt, user._id, {
        userAgent: req.get("user-agent"),
        ip: req.ip,
      });

      res
        .cookie(process.env.REFRESH_COOKIE_NAME, newRt, refreshCookieOptions())
        .json({ success: true, data: { accessToken } });
    } catch (err) {
      // LOG 5: Catch any unexpected errors
      console.error("[refresh] CRITICAL ERROR:", err.message, err.stack);
      next(err);
    }
  }

  // ------------------ LOGOUT (revoke current) ------------------
  async logout(req, res, next) {
    try {
      const rt =
        req.signedCookies?.[process.env.REFRESH_COOKIE_NAME] ||
        req.cookies?.[process.env.REFRESH_COOKIE_NAME];

      if (rt) {
        // Revoke ONLY the presented refresh token
        await revokeRefreshToken(rt);
      }

      res.clearCookie(process.env.REFRESH_COOKIE_NAME, refreshCookieOptions());
      res.json({ success: true, message: "Logged out" });
    } catch (err) {
      next(err);
    }
  }

  // ------------------ FORGOT PASSWORD (issue token) ------------------
  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;
      const user = await User.findOne({ email });

      // ⚠️ SECURITY: Return success even if user not found to prevent email enumeration
      if (!user) {
        return res.json({
          success: true,
          message:
            "If an account exists, a password reset link has been sent to your email.",
        });
      }

      const resetToken = crypto.randomBytes(20).toString("hex"); // 40 chars
      const resetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      user.resetToken = resetToken;
      user.resetTokenExpiresAt = resetTokenExpiresAt;
      await user.save();

      // ⚠️ You MUST set your FRONTEND_URL in .env
      const resetURL = `${
        process.env.CLIENT_URL || req.protocol + "://" + req.get("host")
      }/reset-password?token=${resetToken}`;

      // Use your email utility to send the link
      await sendPasswordResetLink(user.email,resetURL) // Modify sendOtpMail if needed to handle context

      res.json({
        success: true,
        message: "Password reset link sent to email.",
      });
    } catch (e) {
      console.error("[forgotPassword] Error:", e);
      next(e);
    }
  }

  // ------------------ RESET PASSWORD (confirm token and set new password) ------------------
  async resetPassword(req, res, next) {
    try {
      const { token, newPassword } = req.body;
      if (!token) {
        return res
          .status(400)
          .json({ success: false, message: "Reset token is missing." });
      }

      const user = await User.findOne({ resetToken: token });

      if (!user || user.resetTokenExpiresAt < new Date()) {
        // IMPORTANT: Use a generic error message to prevent token/timing attacks
        return res
          .status(400)
          .json({
            success: false,
            message: "Invalid or expired reset request.",
          });
      }

      // 1. Update password and clear token fields
      user.passwordHash = await bcrypt.hash(newPassword, 10);
      user.passwordMustChange = false; // Reset the force change flag if it was set
      user.resetToken = undefined;
      user.resetTokenExpiresAt = undefined;
      await user.save();

      // 2. Revoke ALL active Refresh Tokens (security measure)
      await RefreshToken.updateMany(
        { user: user._id, isRevoked: false },
        {
          $set: {
            isRevoked: true,
            revokedAt: new Date(),
            reason: "password_reset",
          },
        }
      );

      res.json({
        success: true,
        message: "Password reset successfully. Please log in.",
      });
    } catch (e) {
      next(e);
    }
  }
}

module.exports = new AuthController();
