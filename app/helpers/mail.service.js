const nodemailer = require("nodemailer");

function toBool(v) {
  if (typeof v === "boolean") return v;
  if (!v) return false;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587", 10),
  secure: toBool(process.env.SMTP_SECURE),
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

/**
 * @name sendMail
 * @description Generic function to send an email with custom subject, text, and HTML content.
 */
async function sendMail(to, subject, textContent, htmlContent) {
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: subject,
    text: textContent,
    html: htmlContent,
  });
  return info.messageId;
}

async function sendOtpMail(to, otp) {
  const subject = "Your TeamBoard OTP";
  const text = `Your OTP is ${otp}. It is valid for 10 minutes.`;
  const html = `<p>Your OTP is <b>${otp}</b>. It is valid for 10 minutes.</p>`;

  try {
    return await sendMail(to, subject, text, html);
  } catch (err) {
    console.error("sendOtpMail failed:", err?.message || err);
    throw err; // rethrow so caller can handle/display error
  }
}

/**
 * @name sendPasswordResetLink
 * @description Sends a password reset link.
 */

async function sendPasswordResetLink(to, resetURL) {
  const subject = "Password Reset Request";
  const textContent = `You requested a password reset. Your reset link is: ${resetURL}. It is valid for 1 hour. If you did not request a password reset, please ignore this email.`;

  const htmlContent = `
        <p>You requested a password reset. Click the button below to reset your password. This link is valid for 1 hour.</p>
        <p style="text-align: center; margin: 20px 0;">
            <a href="${resetURL}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Reset My Password
            </a>
        </p>
        <p>If the button doesn't work, copy and paste the following link into your browser:</p>
        <p><a href="${resetURL}">${resetURL}</a></p>
        <p>If you did not request a password reset, please ignore this email.</p>
    `;

  return sendMail(to, subject, textContent, htmlContent);
}

async function sendWelcomeSelf(to) {
  return transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "Welcome to TeamBoard",
    html: `<p>Your account is verified. <a href="${process.env.CLIENT_URL}/login">Login</a> to get started.</p>`,
  });
}
async function sendWelcomeWithCredentials(to, roleName, email, tempPassword) {
  return transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: `Your ${roleName} account on TeamBoard`,
    html: `
      <p>Hello, your <b>${roleName}</b> account has been created.</p>
      <p><b>Login email:</b> ${email}<br><b>Temporary password:</b> ${tempPassword}</p>
      <p>Please <a href="${process.env.CLIENT_URL}/login">login</a> and change your password.</p>
    `,
  });
}
async function sendRoleChangeNotice(to, newRole) {
  return transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: `Your role has changed to ${newRole}`,
    html: `<p>Your TeamBoard role is now <b>${newRole}</b>. <a href="${process.env.CLIENT_URL}/login">Login</a> to access your new permissions.</p>`,
  });
}

module.exports = {
  sendMail,
  sendOtpMail,
  sendPasswordResetLink,
  sendWelcomeSelf,
  sendWelcomeWithCredentials,
  sendRoleChangeNotice,
};
