const mongoose = require("mongoose");

const RefreshTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      index: true,
    }, // store hash, never raw token
    userAgent: String,
    ip: String,
    isRevoked: {
      type: Boolean,
      default: false,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("RefreshToken", RefreshTokenSchema);
