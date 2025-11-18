const { Schema, model } = require("mongoose");

const ActivityLogSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    }, // who did it
    action: {
      type: String,
      required: true,
    }, // e.g. 'task.status_changed'
    entity: {
      type: String,
      required: true,
    }, // 'Task'
    entityId: {
      type: Schema.Types.ObjectId,
      refPath: "entity",
      required: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    metadata: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true }
);
module.exports = model("ActivityLog", ActivityLogSchema);
