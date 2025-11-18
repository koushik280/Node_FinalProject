const Joi = require("joi");

const listUsersQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  role: Joi.string().valid("superadmin", "admin", "manager", "employee"),
  search: Joi.string().max(50),
});

const updateUserRoleBody = Joi.object({
  roleName: Joi.string()
    .valid("superadmin", "admin", "manager", "employee")
    .required(),
});

const createUserBody = Joi.object({
  name: Joi.string().min(2).max(40).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).max(50).optional().allow('', null),
  roleName: Joi.string()
    .valid("superadmin", "admin", "manager", "employee")
    .default("employee"),
  isVerified: Joi.boolean().default(true), // SA-created users are verified by default
});

module.exports = {
  listUsersQuery,
  updateUserRoleBody,
  createUserBody,
};
