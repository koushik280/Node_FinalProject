// usage:
//   validate(schema)                   -> validates req.body (default)
//   validate(schema, 'params')         -> validates req.params
//   validate(schema, 'query')          -> validates req.query

const Joi = require('joi');

module.exports = (schema, where = 'body') => (req, res, next) => {
  const loc =
    where === 'params' || where === 'param' ? 'params' :
    where === 'query'  ? 'query'  : 'body';

  const options = { abortEarly: false, stripUnknown: true };
  const source = req[loc] || {};
  const { value, error } = schema.validate(source, options);

  if (error) {
    return res.status(400).json({
      success: false,
      errors: error.details.map(d => d.message)
    });
  }

  // write sanitized values back
  req[loc] = { ...source, ...value };
  next();
};
