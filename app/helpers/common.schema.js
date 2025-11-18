const Joi = require("joi");

const objectIdParam = Joi.object({
  id: Joi.string().length(24).hex().required(),
});

module.exports = { objectIdParam };
