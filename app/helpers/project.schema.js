const Joi = require('joi');

const createProject = Joi.object({
  name: Joi.string().min(2).max(80).required(),
  description: Joi.string().allow('', null),
  managers: Joi.array().items(Joi.string().hex().length(24)).default([]),
  members: Joi.array().items(Joi.string().hex().length(24)).default([])
});

const updateProject = Joi.object({
  name: Joi.string().min(2).max(80),
  description: Joi.string().allow('', null),
  managers: Joi.array().items(Joi.string().hex().length(24)),
  members: Joi.array().items(Joi.string().hex().length(24))
});

const listQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().max(50)
});

const memberOpsBody = Joi.object({
  userIds: Joi.array().items(Joi.string().length(24).hex()).min(1).required()
});






module.exports = { createProject, updateProject, listQuery,memberOpsBody };
