const ActivityLog = require('../models/ActivityLog.model');

exports.recent = async (req, res, next) => {
  try {
    const q = {};
    if (req.query.projectId) q.projectId = req.query.projectId;
    const items = await ActivityLog.find(q)
      .sort({ createdAt: -1 })
      .limit(Number(req.query.limit || 10))
      .populate('userId','name email')
      .lean();
    res.json({ success: true, data: items });
  } catch (e) { next(e); }
};
