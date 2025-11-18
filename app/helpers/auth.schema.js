const Joi = require("joi");

const registerSchema = Joi.object({
  name: Joi.string().min(2).max(80).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).max(128).required(),
  avatar: Joi.object({
    url: Joi.string().uri(),
    publicId: Joi.string()
  }).optional()
});

const verifySchema = Joi.object({
  email: Joi.string().email().required(),
  otp: Joi.string().length(6).required(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const changePwdSchema = Joi.object({
  oldPassword: Joi.string().required(),
  newPassword: Joi.string().min(6).max(50).required(),
});

const forgotPasswordSchema = Joi.object({
    email: Joi.string().email().required().messages({
        'string.email': 'Must be a valid email address',
        'any.required': 'Email is required',
    }),
});

const resetPasswordSchema = Joi.object({
    token: Joi.string().required().messages({
        'any.required': 'Reset token is missing'
    }),
    newPassword: Joi.string().min(6).required().messages({
        'string.min': 'Password must be at least 6 characters',
        'any.required': 'New password is required',
    }),
    confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required().messages({
        'any.only': 'Passwords do not match',
        'any.required': 'Confirmation password is required',
    }),
});

module.exports = {
  registerSchema,
  verifySchema,
  loginSchema,
  changePwdSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
};
