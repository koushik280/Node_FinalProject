router.post('/api/chat//guest', async (req, res) => {
  try {
    const text = req.body.text || '';

    // simple rule-based bot until you upgrade
    const q = text.toLowerCase();

    let reply = "I can help with Login, Register, Projects, Tasks.";

    if (q.includes("login")) reply = "To login, click Sign In and enter your email + password.";
    else if (q.includes("register")) reply = "To register, click Register and verify via OTP.";
    else if (q.includes("project")) reply = "Projects organize your tasks. Owners can add managers & members.";
    else if (q.includes("task")) reply = "Tasks contain title, description, priority, due date, and assignee.";
    else if (q.includes("feature")) reply = "TeamBoard includes Projects, Tasks, Chat, Role-based access, and File Uploads.";

    res.json({ success: true, reply });
  } catch (err) {
    res.json({ success: false, reply: "Error: Bot unavailable." });
  }
});
