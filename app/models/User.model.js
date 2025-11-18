const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      required: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    otp: {
      code: String,
      expiresAt: Date,
    },
    avatar: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
    },
    passwordMustChange: {
      type: Boolean,
      default: false,
    },
    resetToken: {
      type: String,
      default: null, // Stores the secure token sent via email
    },
    resetTokenExpiresAt: {
      type: Date,
      default: null, // Time limit for the token (e.g., 1 hour)
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
