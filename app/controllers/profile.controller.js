const User = require("../models/User.model");
const cloudinary = require("../config/cloudinary");
const {
  uploadAvatarToCloudinary,
  deleteFromCloudinary,
} = require("../middlewares/upload");

exports.getProfile = async (req, res, next) => {
  try {
    const me = await User.findById(req.user.id).populate("role", "name");
    res.render("profile/index", { me });
  } catch (e) {
    next(e);
  }
};

exports.updateAvatar = async (req, res, next) => {
  try {
    if (!req.file?.buffer) {
      req.flash("error", "No image uploaded");
      return res.redirect("/profile");
    }
    const me = await User.findById(req.user.id);
    const up = await uploadAvatarToCloudinary(req.file.buffer);
    if (me.avatar?.publicId) {
      try {
        await deleteFromCloudinary(me.avatar.publicId);
      } catch {}
    }
    me.avatar = { url: up.url, publicId: up.publicId };
    await me.save();
    req.flash("success", "Profile image updated");
    res.redirect("/profile");
  } catch (e) {
    req.flash("error", e.message || "Avatar upload failed");
    res.redirect("/profile");
  }
};

exports.updateBasic = async (req, res, next) => {
  try {
    const me = await User.findById(req.user.id);
    me.name = req.body.name || me.name;
    // optionally allow email change with re-verify; keep simple for now:
    await me.save();
    req.flash("success", "Profile updated");
    res.redirect("/profile");
  } catch (e) {
    req.flash("error", e.message || "Update failed");
    res.redirect("/profile");
  }
};
