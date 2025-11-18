const mongoose = require("mongoose");
const ChatMessageSchema = new mongoose.Schema(
  {
    room: {
      type: String,
      required: true,
    }, // e.g. 'global' or `project:<id>` or `user:<id>`
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }, // null for bot
    senderName: {
      type: String,
    }, // cached display
    isBot: {
      type: Boolean,
      default: false,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    meta: {
      type: Object,
    }, // optional payloads
  },
  { timestamps: true }
);

module.exports = mongoose.model("ChatMessage", ChatMessageSchema);
