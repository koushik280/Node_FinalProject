const mongoose = require("mongoose");

const RoleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      enum: ["superadmin", "admin", "manager", "employee"],
      required: true,
      unique: true,
    },
    // optional: explicit permissions so RBAC is flexible
    permissions: [{ type: String }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Role", RoleSchema);
