const bcrypt = require('bcrypt');
const User = require('../models/User.model');
const Role = require('../models/Role.model');

module.exports = async function seedSuperAdmin() {
  const email = process.env.SA_EMAIL;
  const pass  = process.env.SA_PASSWORD;
  const name  = process.env.SA_NAME || 'Super Admin';

  if (!email || !pass) {
    console.warn('SA_EMAIL/SA_PASSWORD not set. Skipping superadmin seeding.');
    return;
  }

  const role = await Role.findOne({ name: 'superadmin' });
  if (!role) {
    console.error('superadmin role missing. Run seedRoles first.');
    return;
  }

  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      name,
      email,
      passwordHash: await bcrypt.hash(pass, 10),
      role: role._id,
      isVerified: true
    });
    console.log(`Super Admin created: ${email}`);
  } else {
    // ensure role is superadmin
    if (String(user.role) !== String(role._id)) {
      user.role = role._id;
      user.isVerified = true;
      await user.save();
      console.log(`Existing user promoted to Super Admin: ${email}`);
    } else {
      console.log('Super Admin already present.');
    }
  }
};
