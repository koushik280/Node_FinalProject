const User = require('../models/User.model');
const Project = require('../models/Project.model');
const Task = require('../models/Task.model');

exports.summary = async (req, res, next) => {
  try {
    // Top cards
    const [users, projects, tasks] = await Promise.all([
      User.countDocuments(),
      Project.countDocuments(),
      Task.countDocuments()
    ]);

    // Users by role (role name)
    const usersByRole = await User.aggregate([
      { $lookup: { from: 'roles', localField: 'role', foreignField: '_id', as: 'r' } },
      { $unwind: '$r' },
      { $group: { _id: '$r.name', count: { $sum: 1 } } },
      { $project: { _id: 0, role: '$_id', count: 1 } },
      { $sort: { role: 1 } }
    ]);

    // Tasks by status
    const tasksByStatus = await Task.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $project: { _id: 0, status: '$_id', count: 1 } },
      { $sort: { status: 1 } }
    ]);

    // Due in next 7 days
    const now = new Date();
    const soon = new Date(now.getTime() + 7*24*60*60*1000);
    const dueSoon = await Task.countDocuments({ dueDate: { $gte: now, $lte: soon } });

    res.json({
      success: true,
      data: {
        totals: { users, projects, tasks, dueSoon },
        usersByRole,
        tasksByStatus
      }
    });
  } catch (e) { next(e); }
};
