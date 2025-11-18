const hierarchy = ["employee", "manager", "admin", "superadmin"];

module.exports = function rbac(minRoleName = "employee") {
  return (req, res, next) => {
    if (!req.user?.role)
      return res.status(403).json({ success: false, message: "Forbidden" });
    const userRank = hierarchy.indexOf(req.user.role);
    const needRank = hierarchy.indexOf(minRoleName);
    if (userRank < 0 || needRank < 0 || userRank < needRank) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    next();
  };
};
