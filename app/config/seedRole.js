const Role = require("../models/Role.model");

module.exports = async function seedRoles() {
  const base = [
    { name: "superadmin", permissions: ["*"] },
    {
      name: "admin",
      permissions: [
        "user.read",
        "user.manage",
        "project.create",
        "project.manage",
      ],
    },
    {
      name: "manager",
      permissions: ["project.create", "task.assign", "task.manage"],
    },
    { name: "employee", permissions: ["task.self"] },
  ];
  for (const r of base) {
    await Role.updateOne(
      { name: r.name },
      { $setOnInsert: r },
      { upsert: true }
    );
  }
};
