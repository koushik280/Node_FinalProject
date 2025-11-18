const mongoose = require("mongoose");

const CommentSchema = new mongoose.Schema(
  {
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, trim: true, maxlength: 2000 },
    files: [
      {
        url: { type: String, required: true },
        publicId: { type: String, required: true },
        name: { type: String, required: true },
        size: { type: Number, default: 0 },
        type: { type: String, default: "" }, // mime
      },
    ],
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const AttachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    name: { type: String, required: true },
    size: { type: Number, default: 0 },
    type: { type: String, default: "" }, // mime
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const TaskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      requried: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 5000,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ["Pending", "In Progress", "Completed"],
      default: "Pending",
      index: true,
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High", "Critical"],
      default: "Medium",
    },
    dueDate: {
      type: Date,
      default: null,
    },
    attachments: {
      type: [AttachmentSchema],
      default: [],
    }, // integrate Cloudinary later
    comments: [CommentSchema],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

TaskSchema.index({ projectId: 1, 'comments.createdAt': -1 });
TaskSchema.index({ projectId: 1, 'attachments.createdAt': -1 });


module.exports = mongoose.model("Task", TaskSchema);
