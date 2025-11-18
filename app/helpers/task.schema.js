const Joi = require('joi');

const objectId = Joi.string().length(24).hex();

exports.createTaskBody = Joi.object({
  title: Joi.string().max(120).required(),
  description: Joi.string().max(5000).allow('', null),
  projectId: objectId.required(),
  priority: Joi.string().valid('Low','Medium','High','Critical').default('Medium'),
  dueDate: Joi.date().optional().allow(null)
});

exports.assignBody = Joi.object({
  userId: objectId.required()
});

exports.statusBody = Joi.object({
  status: Joi.string().valid('Pending','In Progress','Completed','pending','in_progress','completed').required()
});

exports.updateTaskBody = Joi.object({
  title: Joi.string().max(120).optional(),
  description: Joi.string().max(5000).allow('', null),
  priority: Joi.string().valid('Low','Medium','High','Critical').optional(),
  dueDate: Joi.date().optional().allow(null)
}).min(1);

exports.taskIdParam = Joi.object({
  id: objectId.required()
});

exports.projectIdParam = Joi.object({
  id: objectId.required()
});


exports.commentCreateBody = Joi.object({
  text: Joi.string().max(2000).allow('', null),
}).or('text'); // at least text or files (files handled by multer)

exports.commentIdParam = Joi.object({
  taskId: objectId.required(),
  commentId: objectId.required()
});

exports.taskIdParam2 = Joi.object({ // for routes using :taskId param name
  taskId: objectId.required()
});