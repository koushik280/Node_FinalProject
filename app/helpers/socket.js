exports.emitToProject = (app, projectId, event, payload) => {
  const io = app.get('io');
  io?.to(`project:${String(projectId)}`).emit(event, payload);
};

exports.emitToUser = (app, userId, event, payload) => {
  const io = app.get('io');
  io?.to(`user:${String(userId)}`).emit(event, payload);
};