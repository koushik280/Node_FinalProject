
const express = require('express');
const router =express.Router();
const auth = require('../middlewares/auth');
const { attachmentUpload } = require('../middlewares/upload');
const ctrl = require('../controllers/taskComment.controller');

router.use(auth()); // require JWT for all below

// comments
router.post('/:taskId/comments', attachmentUpload.array('files', 5), ctrl.addComment);
router.get('/:taskId/comments', ctrl.listComments);
router.delete('/:taskId/comments/:commentId', ctrl.deleteComment);

// attachments (single or multiple)
router.post('/:taskId/attachments', attachmentUpload.single('file'), ctrl.addAttachment);
//router.post('/:taskId/attachments/:publicId(.*)/delete', ctrl.deleteAttachment);
router.post('/:taskId/attachments/delete', ctrl.deleteAttachment);
module.exports = router;

