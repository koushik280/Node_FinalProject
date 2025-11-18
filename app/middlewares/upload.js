// app/middlewares/upload.js
const multer = require('multer');
const cloudinary = require('../config/cloudinary');

/* ---------- Config ---------- */
const MAX_AVATAR = Number(process.env.MAX_AVATAR_MB || 2) * 1024 * 1024;      // 2 MB default
const MAX_ATTACH = Number(process.env.MAX_ATTACHMENT_MB || 10) * 1024 * 1024; // 10 MB default

// Image types allowed for avatars
const IMAGE_MIME = ['image/jpeg','image/png','image/webp','image/jpg'];

// Common file types for attachments (expand as needed)
const FILE_MIME = [
  ...IMAGE_MIME,
  'application/pdf',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain'
];

const memory = multer.memoryStorage();

/* ---------- Multer uploaders ---------- */
// Strict avatar uploader: only images, smaller size
const avatarUpload = multer({
  storage: memory,
  limits: { fileSize: MAX_AVATAR },
  fileFilter: (req, file, cb) => {
    if (IMAGE_MIME.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPG/PNG/WEBP allowed for avatar'));
  }
});

// Generic attachment uploader: broader mime support, larger size
const attachmentUpload = multer({
  storage: memory,
  limits: { fileSize: MAX_ATTACH },
  fileFilter: (req, file, cb) => {
    if (FILE_MIME.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported file type'));
  }
});

/* ---------- Cloudinary helpers ---------- */
// Low-level generic upload (any file)
const uploadToCloudinary = (buffer, { folder = 'teamboard', resource_type = 'auto', transformation } = {}) =>
  new Promise((resolve, reject) => {
    const opts = { folder, resource_type };
    if (transformation) opts.transformation = transformation;

    const stream = cloudinary.uploader.upload_stream(
      opts,
      (err, result) => (err ? reject(err) : resolve({
        url: result.secure_url,
        publicId: result.public_id,
        format: result.format,
        bytes: result.bytes,
        width: result.width,
        height: result.height,
        folder: result.folder,
      }))
    );
    stream.end(buffer);
  });

// Opinionated avatar upload (face crop 256x256)
const uploadAvatarToCloudinary = (buffer, folder = 'teamboard/avatars') =>
  uploadToCloudinary(buffer, {
    folder,
    resource_type: 'image',
    transformation: [{ width: 256, height: 256, crop: 'thumb', gravity: 'face' }]
  });

// Delete by publicId
const deleteFromCloudinary = (publicId) =>
  new Promise((resolve, reject) => {
    if (!publicId) return resolve({ result: 'not_found' });
    cloudinary.uploader.destroy(publicId, (err, res) => (err ? reject(err) : resolve(res)));
  });

module.exports = {
  // multer
  avatarUpload,
  attachmentUpload,
  // helpers
  uploadToCloudinary,
  uploadAvatarToCloudinary,
  deleteFromCloudinary,
  // exported mime lists (handy for UI/hints)
  IMAGE_MIME,
  FILE_MIME,
};
