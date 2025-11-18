const hierarchy = ['employee','manager','admin','superadmin'];

module.exports = function webRbac(minRole = 'employee') {
  return (req, res, next) => {
    const role = req.webUser?.role;
    if (!role) return res.redirect('/login');
    if (hierarchy.indexOf(role) < hierarchy.indexOf(minRole)) {
      return res.status(403).render('errors/403');
    }
    next();
  };
};

