// (function(){
//   const ME = window.__ME__ || {};
//   const ROOM = window.__ROOM__ || 'global';

//   // connect (rely on cookie AT being sent automatically with withCredentials)
//   const socket = io({ withCredentials: true, auth: ME.__token || undefined });

//   // UI elements
//   const msgList = document.getElementById('msgList');
//   const composer = document.getElementById('composer');
//   const btnSend = document.getElementById('btnSend');
//   const memberCount = document.getElementById('memberCount');
//   const detailPane = document.getElementById('detailPane');

//   // last tasks list (populated from bot message extras)
//   window.__lastTasks = []; // [{ idx, id, title, status, priority, dueDate, projectId }]

//   function escapeHtml(s){ return (s||'').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

//   function appendMessage(msgObj) {
//     if (!msgList) return;
//     const div = document.createElement('div');
//     div.className = 'mb-2';
//     const who = msgObj.isBot ? 'Bot' : (msgObj.senderName || (msgObj.from && msgObj.from.name) || 'User');
//     const time = new Date(msgObj.createdAt || msgObj.ts || Date.now()).toLocaleTimeString();
//     const text = msgObj.message || msgObj.text || '';
//     div.innerHTML = `<div class="small text-muted">${escapeHtml(who)} • ${escapeHtml(time)}</div>
//                      <div>${escapeHtml(text)}</div>`;
//     msgList.appendChild(div);
//     msgList.scrollTop = msgList.scrollHeight;
//   }

//   // Extract tasks if server sends them under different keys
//   function extractTasksFromMsg(m) {
//     if (!m) return null;
//     if (Array.isArray(m.tasks) && m.tasks.length) return m.tasks;
//     if (m.data && Array.isArray(m.data.tasks) && m.data.tasks.length) return m.data.tasks;
//     if (m.extras && Array.isArray(m.extras.tasks) && m.extras.tasks.length) return m.extras.tasks;
//     if (m.payload && Array.isArray(m.payload.tasks) && m.payload.tasks.length) return m.payload.tasks;
//     if (m.meta && Array.isArray(m.meta.tasks) && m.meta.tasks.length) return m.meta.tasks;
//     if (m.result && Array.isArray(m.result.tasks) && m.result.tasks.length) return m.result.tasks;
//     if (Array.isArray(m.items) && m.items.length) return m.items;
//     return null;
//   }

//   // normalize a single task object to our expected shape
//   function normalizeTaskObj(t, i) {
//     return {
//       idx: t.idx || (i + 1),
//       id: t.id || t._id || t.taskId || t._taskId || '',
//       title: t.title || t.name || t.summary || 'Untitled',
//       status: t.status || t.state || '',
//       priority: t.priority || t.prio || '',
//       dueDate: t.dueDate || t.due || t.due_date || null,
//       projectId: t.projectId || t.project || null,
//       raw: t
//     };
//   }

//   // specialized render for messages that include structured tasks
//   function handleBotMessageWithTasks(msgObj) {
//     const tasksFromMsg = extractTasksFromMsg(msgObj);
//     if (!tasksFromMsg || !tasksFromMsg.length) return false;

//     const normalized = tasksFromMsg.map((t, i) => normalizeTaskObj(t, i)).filter(t => t.id);
//     window.__lastTasks = normalized;

//     if (detailPane) {
//       const wrapper = document.createElement('div');
//       wrapper.innerHTML = `
//         <h6>Your tasks</h6>
//         <div class="list-group mb-3" id="botTaskList">
//           ${normalized.map(t => `
//             <a href="#" class="list-group-item list-group-item-action bot-task-item" data-id="${escapeHtml(t.id)}" data-idx="${t.idx}">
//               <div class="d-flex justify-content-between">
//                 <div>
//                   <strong>${escapeHtml(t.idx + '. ' + t.title)}</strong>
//                   <div class="small text-muted">${escapeHtml(t.status || '')} · ${escapeHtml(t.priority || '')}</div>
//                 </div>
//                 <div class="small text-muted">${t.dueDate ? new Date(t.dueDate).toLocaleDateString() : '—'}</div>
//               </div>
//             </a>`).join('')}
//         </div>
//         <div class="small text-muted">Click a task to view details or use <code>status to</code> / <code>assign to</code>.</div>
//       `;
//       detailPane.innerHTML = '';
//       detailPane.appendChild(wrapper);

//       wrapper.querySelectorAll('.bot-task-item').forEach(el => {
//         el.addEventListener('click', async (ev) => {
//           ev.preventDefault();
//           const taskId = el.dataset.id;
//           await showTaskDetail(taskId);
//         });
//       });
//     }
//     return true;
//   }

//   // Helper to get cookie value by name
//   function getCookie(name) {
//     const value = `; ${document.cookie}`;
//     const parts = value.split(`; ${name}=`);
//     if (parts.length === 2) return parts.pop().split(';').shift();
//     return null;
//   }

//   async function showTaskDetail(taskId) {
//     try {
//       // Get the AT token from cookies
//       const atToken = getCookie('AT');

//       const headers = {
//         'Content-Type': 'application/json'
//       };

//       // Add Authorization header if token exists
//       if (atToken) {
//         headers['Authorization'] = `Bearer ${atToken}`;
//       }

//       const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
//         credentials: 'include',
//         headers: headers
//       });

//       if (!res.ok) {
//         const errorText = await res.text().catch(() => '');
//         console.error('Task fetch failed:', res.status, errorText);
//         detailPane.innerHTML = `<div class="alert alert-warning">Could not load task details (status ${res.status}). ${res.status === 401 ? 'Please refresh the page and try again.' : ''}</div>`;
//         return;
//       }

//       const json = await res.json();
//       const t = (json && json.data) ? json.data : (json && json.task) ? json.task : json;

//       if (!t || !t.title) {
//         detailPane.innerHTML = `<div class="alert alert-warning">Task data not found.</div>`;
//         return;
//       }

//       const due = t.dueDate ? new Date(t.dueDate).toLocaleString() : '—';
//       const projectName = (t.project && t.project.name) ||
//                           (t.projectId && t.projectId.name) ||
//                           (typeof t.projectId === 'string' ? t.projectId : '') ||
//                           '—';
//       const assignedTo = (t.assignedTo && t.assignedTo.name) ||
//                          (t.assignedTo && t.assignedTo.email) ||
//                          'Unassigned';

//       detailPane.innerHTML = `
//         <div class="d-flex justify-content-between align-items-start mb-3">
//           <h5 class="mb-0">${escapeHtml(t.title || 'Task')}</h5>
//           <button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById('detailPane').innerHTML=''">×</button>
//         </div>
//         <div class="mb-3">
//           <span class="badge bg-${t.status === 'Completed' ? 'success' : t.status === 'In Progress' ? 'primary' : 'secondary'}">${escapeHtml(t.status || 'Pending')}</span>
//           <span class="badge bg-${t.priority === 'High' ? 'danger' : t.priority === 'Medium' ? 'warning' : 'info'}">${escapeHtml(t.priority || 'Low')}</span>
//         </div>
//         <div class="mb-2"><strong>Project:</strong> ${escapeHtml(projectName)}</div>
//         <div class="mb-2"><strong>Assigned to:</strong> ${escapeHtml(assignedTo)}</div>
//         <div class="mb-2"><strong>Due:</strong> ${escapeHtml(due)}</div>
//         <div class="mb-3"><strong>Description:</strong><br>${escapeHtml(t.description || 'No description')}</div>
//         <div class="d-flex gap-2 flex-wrap">
//           <button id="btnSetInProgress" class="btn btn-sm btn-outline-primary" ${t.status === 'In Progress' ? 'disabled' : ''}>
//             Set In Progress
//           </button>
//           <button id="btnSetCompleted" class="btn btn-sm btn-outline-success" ${t.status === 'Completed' ? 'disabled' : ''}>
//             Set Completed
//           </button>
//           <button id="btnSetPending" class="btn btn-sm btn-outline-secondary" ${t.status === 'Pending' ? 'disabled' : ''}>
//             Set Pending
//           </button>
//         </div>
//       `;

//       // Wire quick status buttons
//       document.getElementById('btnSetInProgress')?.addEventListener('click', () => {
//         socket.emit('chat:send', {
//           room: ROOM,
//           message: `status to In Progress ${taskId}`,
//           senderId: ME.id || ME._id || null,
//           senderName: ME.name || ME.email || null
//         });
//         // Optimistically update UI
//         setTimeout(() => showTaskDetail(taskId), 500);
//       });

//       document.getElementById('btnSetCompleted')?.addEventListener('click', () => {
//         socket.emit('chat:send', {
//           room: ROOM,
//           message: `status to Completed ${taskId}`,
//           senderId: ME.id || ME._id || null,
//           senderName: ME.name || ME.email || null
//         });
//         setTimeout(() => showTaskDetail(taskId), 500);
//       });

//       document.getElementById('btnSetPending')?.addEventListener('click', () => {
//         socket.emit('chat:send', {
//           room: ROOM,
//           message: `status to Pending ${taskId}`,
//           senderId: ME.id || ME._id || null,
//           senderName: ME.name || ME.email || null
//         });
//         setTimeout(() => showTaskDetail(taskId), 500);
//       });

//     } catch (err) {
//       detailPane.innerHTML = `<div class="alert alert-danger">Error loading details: ${escapeHtml(err.message)}</div>`;
//       console.error('task detail fetch error', err);
//     }
//   }

//   // connect and join room
//   socket.on('connect', ()=> {
//     socket.emit('join', ROOM);
//     console.debug('[chat.js] connected, socket.id=', socket.id, 'ROOM=', ROOM, 'ME=', ME);
//   });

//   socket.on('memberCount', cnt => {
//     if (memberCount) memberCount.textContent = `${cnt} online`;
//   });

//   socket.on('chat:message', (m) => {
//     try {
//       console.debug('[chat.js] incoming chat:message', m);
//       appendMessage(m);
//       if (m && m.isBot) {
//         const rendered = handleBotMessageWithTasks(m);
//         if (rendered) {
//           console.debug('[chat.js] bot tasks rendered into right pane', window.__lastTasks);
//         } else {
//           console.debug('[chat.js] no tasks array found in bot message');
//         }
//       }
//     } catch (err) {
//       console.error('chat:message handler error', err);
//     }
//   });

//   // Wire UI: send action
//   if (btnSend) {
//     btnSend.addEventListener('click', send);
//   }
//   if (composer) {
//     composer.addEventListener('keydown', e => {
//       if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
//     });
//   }

//   // Quick chips
//   document.querySelectorAll('[data-cmd]').forEach(btn => {
//     btn.addEventListener('click', (ev) => {
//       const cmd = btn.getAttribute('data-cmd') || '';
//       const immediate = ['my tasks', 'mytasks', 'project summary', 'projectsummary', 'help'];
//       if (immediate.includes(cmd.toLowerCase())) {
//         socket.emit('chat:send', {
//           room: ROOM,
//           message: cmd,
//           senderId: ME.id || ME._id || null,
//           senderName: ME.name || ME.email || null
//         });
//         return;
//       }
//       const prefill = cmd + ' ';
//       if (composer) {
//         composer.value = prefill;
//         composer.focus();
//         composer.setSelectionRange(prefill.length, prefill.length);
//       }
//     });
//   });

//   function send(){
//     if (!composer) return;
//     const text = (composer.value || '').trim();
//     if (!text) return;
//     socket.emit('chat:send', {
//       room: ROOM,
//       message: text,
//       senderId: ME.id || ME._id || null,
//       senderName: ME.name || ME.email || null
//     });
//     composer.value = '';
//   }
// })();

(function () {
  const ME = window.__ME__ || {};
  let ROOM = window.__ROOM__ || "global"; // mutable so left pane can change it

  // connect (rely on cookie AT being sent automatically with withCredentials)
  const socket = io({ withCredentials: true, auth: ME.__token || undefined });

  // UI elements (left + center + right)
  const threadList = document.getElementById("threadList");
  const threadSearch = document.getElementById("threadSearch");
  const btnNewRoom = document.getElementById("btnNewRoom");

  const msgList = document.getElementById("msgList");
  const composer = document.getElementById("composer");
  const btnSend = document.getElementById("btnSend");
  const memberCount = document.getElementById("memberCount");
  const detailPane = document.getElementById("detailPane");

  // last tasks list (populated from bot message extras)
  window.__lastTasks = []; // [{ idx, id, title, status, priority, dueDate, projectId }]

  function escapeHtml(s) {
    return (s || "").replace(
      /[&<>'"]/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        }[c])
    );
  }

  function appendMessage(msgObj) {
    if (!msgList) return;
    const div = document.createElement("div");
    div.className = "mb-2";
    const who = msgObj.isBot
      ? "Bot"
      : msgObj.senderName || (msgObj.from && msgObj.from.name) || "User";
    const time = new Date(
      msgObj.createdAt || msgObj.ts || Date.now()
    ).toLocaleTimeString();
    const text = msgObj.message || msgObj.text || "";
    div.innerHTML = `<div class="small text-muted">${escapeHtml(
      who
    )} • ${escapeHtml(time)}</div>
                     <div>${escapeHtml(text)}</div>`;
    msgList.appendChild(div);
    msgList.scrollTop = msgList.scrollHeight;
  }

  // --- tasks extraction & detail rendering (unchanged logic) ---
  function extractTasksFromMsg(m) {
    if (!m) return null;
    if (Array.isArray(m.tasks) && m.tasks.length) return m.tasks;
    if (m.data && Array.isArray(m.data.tasks) && m.data.tasks.length)
      return m.data.tasks;
    if (m.extras && Array.isArray(m.extras.tasks) && m.extras.tasks.length)
      return m.extras.tasks;
    if (m.payload && Array.isArray(m.payload.tasks) && m.payload.tasks.length)
      return m.payload.tasks;
    if (m.meta && Array.isArray(m.meta.tasks) && m.meta.tasks.length)
      return m.meta.tasks;
    if (m.result && Array.isArray(m.result.tasks) && m.result.tasks.length)
      return m.result.tasks;
    if (Array.isArray(m.items) && m.items.length) return m.items;
    return null;
  }

  function normalizeTaskObj(t, i) {
    return {
      idx: t.idx || i + 1,
      id: t.id || t._id || t.taskId || t._taskId || "",
      title: t.title || t.name || t.summary || "Untitled",
      status: t.status || t.state || "",
      priority: t.priority || t.prio || "",
      dueDate: t.dueDate || t.due || t.due_date || null,
      projectId: t.projectId || t.project || null,
      raw: t,
    };
  }

  function handleBotMessageWithTasks(msgObj) {
    const tasksFromMsg = extractTasksFromMsg(msgObj);
    if (!tasksFromMsg || !tasksFromMsg.length) return false;

    const normalized = tasksFromMsg
      .map((t, i) => normalizeTaskObj(t, i))
      .filter((t) => t.id);
    window.__lastTasks = normalized;

    if (detailPane) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = `
        <h6>Your tasks</h6>
        <div class="list-group mb-3" id="botTaskList">
          ${normalized
            .map(
              (t) => `
            <a href="#" class="list-group-item list-group-item-action bot-task-item" data-id="${escapeHtml(
              t.id
            )}" data-idx="${t.idx}">
              <div class="d-flex justify-content-between">
                <div>
                  <strong>${escapeHtml(t.idx + ". " + t.title)}</strong>
                  <div class="small text-muted">${escapeHtml(
                    t.status || ""
                  )} · ${escapeHtml(t.priority || "")}</div>
                </div>
                <div class="small text-muted">${
                  t.dueDate ? new Date(t.dueDate).toLocaleDateString() : "—"
                }</div>
              </div>
            </a>`
            )
            .join("")}
        </div>
        <div class="small text-muted">Click a task to view details or use <code>status to</code> / <code>assign to</code>.</div>
      `;
      detailPane.innerHTML = "";
      detailPane.appendChild(wrapper);

      wrapper.querySelectorAll(".bot-task-item").forEach((el) => {
        el.addEventListener("click", async (ev) => {
          ev.preventDefault();
          const taskId = el.dataset.id;
          await showTaskDetail(taskId);
        });
      });
    }
    return true;
  }

  // Helper to get cookie value by name
  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(";").shift();
    return null;
  }

  async function showTaskDetail(taskId) {
    try {
      const atToken = getCookie("AT");
      const headers = { "Content-Type": "application/json" };
      if (atToken) headers["Authorization"] = `Bearer ${atToken}`;

      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        credentials: "include",
        headers: headers,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        console.error("Task fetch failed:", res.status, errorText);
        detailPane.innerHTML = `<div class="alert alert-warning">Could not load task details (status ${
          res.status
        }). ${
          res.status === 401 ? "Please refresh the page and try again." : ""
        }</div>`;
        return;
      }

      const json = await res.json();
      const t =
        json && json.data ? json.data : json && json.task ? json.task : json;

      if (!t || !t.title) {
        detailPane.innerHTML = `<div class="alert alert-warning">Task data not found.</div>`;
        return;
      }

      const due = t.dueDate ? new Date(t.dueDate).toLocaleString() : "—";
      const projectName =
        (t.project && t.project.name) ||
        (t.projectId && t.projectId.name) ||
        (typeof t.projectId === "string" ? t.projectId : "") ||
        "—";
      const assignedTo =
        (t.assignedTo && t.assignedTo.name) ||
        (t.assignedTo && t.assignedTo.email) ||
        "Unassigned";

      detailPane.innerHTML = `
        <div class="d-flex justify-content-between align-items-start mb-3">
          <h5 class="mb-0">${escapeHtml(t.title || "Task")}</h5>
          <button class="btn btn-sm btn-outline-secondary" id="btnCloseDetail">×</button>
        </div>
        <div class="mb-3">
          <span class="badge ${
            t.status === "Completed"
              ? "bg-success"
              : t.status === "In Progress"
              ? "bg-primary"
              : "bg-secondary"
          }">${escapeHtml(t.status || "Pending")}</span>
          <span class="badge ${
            t.priority === "High"
              ? "bg-danger"
              : t.priority === "Medium"
              ? "bg-warning text-dark"
              : "bg-info text-dark"
          }">${escapeHtml(t.priority || "Low")}</span>
        </div>
        <div class="mb-2"><strong>Project:</strong> ${escapeHtml(
          projectName
        )}</div>
        <div class="mb-2"><strong>Assigned to:</strong> ${escapeHtml(
          assignedTo
        )}</div>
        <div class="mb-2"><strong>Due:</strong> ${escapeHtml(due)}</div>
        <div class="mb-3"><strong>Description:</strong><br>${escapeHtml(
          t.description || "No description"
        )}</div>
        <div class="d-flex gap-2 flex-wrap">
          <button id="btnSetInProgress" class="btn btn-sm btn-outline-primary" ${
            t.status === "In Progress" ? "disabled" : ""
          }>Set In Progress</button>
          <button id="btnSetCompleted" class="btn btn-sm btn-outline-success" ${
            t.status === "Completed" ? "disabled" : ""
          }>Set Completed</button>
          <button id="btnSetPending" class="btn btn-sm btn-outline-secondary" ${
            t.status === "Pending" ? "disabled" : ""
          }>Set Pending</button>
        </div>
      `;

      document
        .getElementById("btnCloseDetail")
        ?.addEventListener("click", () => {
          detailPane.innerHTML = "";
        });

      document
        .getElementById("btnSetInProgress")
        ?.addEventListener("click", () => {
          socket.emit("chat:send", {
            room: ROOM,
            message: `status to In Progress ${taskId}`,
            senderId: ME.id || ME._id || null,
            senderName: ME.name || ME.email || null,
          });
          setTimeout(() => showTaskDetail(taskId), 400);
        });

      document
        .getElementById("btnSetCompleted")
        ?.addEventListener("click", () => {
          socket.emit("chat:send", {
            room: ROOM,
            message: `status to Completed ${taskId}`,
            senderId: ME.id || ME._id || null,
            senderName: ME.name || ME.email || null,
          });
          setTimeout(() => showTaskDetail(taskId), 400);
        });

      document
        .getElementById("btnSetPending")
        ?.addEventListener("click", () => {
          socket.emit("chat:send", {
            room: ROOM,
            message: `status to Pending ${taskId}`,
            senderId: ME.id || ME._id || null,
            senderName: ME.name || ME.email || null,
          });
          setTimeout(() => showTaskDetail(taskId), 400);
        });
    } catch (err) {
      detailPane.innerHTML = `<div class="alert alert-danger">Error loading details: ${escapeHtml(
        err.message
      )}</div>`;
      console.error("task detail fetch error", err);
    }
  }

  // ------------------ LEFT pane (threads) wiring ------------------

  // handle clicking a thread item
  function handleThreadClick(ev) {
    ev.preventDefault();
    const el = ev.currentTarget;
    const room = el.getAttribute("data-room");
    if (!room) return;

    // If switching to same room, do nothing
    if (room === ROOM) return;

    // Leave previous room optionally (if you want server to know)
    // socket.emit('leave', ROOM); // uncomment if server listens for 'leave'

    ROOM = room;
    socket.emit("join", ROOM);

    // Update UI active class
    document
      .querySelectorAll(".thread-item")
      .forEach((i) => i.classList.remove("active"));
    el.classList.add("active");

    // Update header
    const title = document.getElementById("roomTitle");
    if (title) title.textContent = `# ${room}`;

    // Clear center messages and right details
    if (msgList)
      msgList.innerHTML = `<div class="small text-muted">Switched to ${escapeHtml(
        room
      )} — messages for this room will appear here.</div>`;
    if (detailPane)
      detailPane.innerHTML = `<div class="detail-empty">Select a task reference like <span class="code">#3</span> from “my tasks” to view & edit here.</div>`;
  }

  // wire all items inside threadList
  function wireThreadList() {
    if (!threadList) return;
    threadList.querySelectorAll(".thread-item").forEach((item) => {
      // remove duplicate listeners
      item.removeEventListener("click", handleThreadClick);
      item.addEventListener("click", handleThreadClick);
    });
  }

  // new room button
  if (btnNewRoom) {
    btnNewRoom.addEventListener("click", () => {
      const name = prompt(
        "Enter name for new room (e.g., project:abc or team:design):"
      );
      if (!name) return;
      const a = document.createElement("a");
      a.className = "list-group-item list-group-item-action thread-item";
      a.setAttribute("data-room", name);
      a.innerHTML = `<div class="d-flex justify-content-between"><div><div class="fw-semibold"># ${escapeHtml(
        name
      )}</div><div class="small text-muted">Custom room</div></div><div class="small text-muted">&nbsp;</div></div>`;
      threadList.appendChild(a);
      wireThreadList();
      a.click(); // join immediately
    });
  }

  // search filter for thread list
  if (threadSearch) {
    threadSearch.addEventListener("input", (e) => {
      const q = (e.target.value || "").toLowerCase().trim();
      threadList.querySelectorAll(".thread-item").forEach((item) => {
        const text = (item.textContent || "").toLowerCase();
        item.style.display = text.includes(q) ? "" : "none";
      });
    });
  }

  // ------------------ socket wiring ------------------
  socket.on("connect", () => {
    socket.emit("join", ROOM);
    console.debug(
      "[chat.js] connected, socket.id=",
      socket.id,
      "ROOM=",
      ROOM,
      "ME=",
      ME
    );
    // make sure left pane items are wired
    wireThreadList();
  });

  socket.on("memberCount", (cnt) => {
    if (memberCount) memberCount.textContent = `${cnt} online`;
  });

  socket.on("chat:message", (m) => {
    try {
      console.debug("[chat.js] incoming chat:message", m);
      appendMessage(m);
      if (m && m.isBot) {
        const rendered = handleBotMessageWithTasks(m);
        if (rendered)
          console.debug(
            "[chat.js] bot tasks rendered into right pane",
            window.__lastTasks
          );
      }
    } catch (err) {
      console.error("chat:message handler error", err);
    }
  });

  // ------------------ composer / quick chips ------------------
  if (btnSend) {
    btnSend.addEventListener("click", send);
  }
  if (composer) {
    composer.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
  }

  // quick command chips
  document.querySelectorAll("[data-cmd]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      const cmd = btn.getAttribute("data-cmd") || "";
      const immediate = [
        "my tasks",
        "mytasks",
        "project summary",
        "projectsummary",
        "help",
      ];
      if (immediate.includes(cmd.toLowerCase())) {
        socket.emit("chat:send", {
          room: ROOM,
          message: cmd,
          senderId: ME.id || ME._id || null,
          senderName: ME.name || ME.email || null,
        });
        return;
      }
      const prefill = cmd + " ";
      if (composer) {
        composer.value = prefill;
        composer.focus();
        composer.setSelectionRange(prefill.length, prefill.length);
      }
    });
  });

  function send() {
    if (!composer) return;
    const text = (composer.value || "").trim();
    if (!text) return;
    socket.emit("chat:send", {
      room: ROOM,
      message: text,
      senderId: ME.id || ME._id || null,
      senderName: ME.name || ME.email || null,
    });
    composer.value = "";
  }

  // LEFT PANE: populate rooms, search, click-to-join, new-room, unread badges
  (async function wireLeftPane() {
    const threadList = document.getElementById("threadList");
    const threadSearch = document.getElementById("threadSearch");
    const btnNewRoom = document.getElementById("btnNewRoom");
    const roomTitle = document.getElementById("roomTitle");

    if (!threadList) return;

    // keep map state: roomName -> { el, unreadCount, lastAt }
    const rooms = new Map();

    // helper build thread item
    function createThreadEl(roomName, label = "") {
      const a = document.createElement("a");
      a.className = "list-group-item list-group-item-action thread-item";
      a.href = "#";
      a.dataset.room = roomName;
      a.innerHTML = `
      <div class="d-flex justify-content-between align-items-center">
        <div>
          <div class="fw-semibold">${escapeHtml(label || roomName)}</div>
          <div class="small text-muted">Room</div>
        </div>
        <div class="d-flex align-items-center gap-2">
          <div class="small text-muted last-time">now</div>
          <span class="badge bg-primary rounded-pill unread-badge d-none">0</span>
        </div>
      </div>`;
      // click handler
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        const r = a.dataset.room;
        // mark active UI
        document
          .querySelectorAll(".thread-item")
          .forEach((x) => x.classList.remove("active"));
        a.classList.add("active");

        // join the room and update UI
        socket.emit("join", r);
        //if (roomTitle) roomTitle.textContent = `# ${r.replace(/^project:/,'') || r}`;
        if (roomTitle) {
          const labelEl = a.querySelector(".fw-semibold");
          const labelText = labelEl
            ? labelEl.textContent.trim()
            : r.replace(/^project:/, "");
          roomTitle.textContent = `# ${labelText}`;
        }

        // reset unread
        const badge = a.querySelector(".unread-badge");
        if (badge) {
          badge.classList.add("d-none");
          badge.textContent = "0";
        }
        rooms.set(r, { el: a, unread: 0 });
      });
      return a;
    }

    // fetch projects from API and populate project:<id> rooms
    async function loadProjects() {
      try {
        const res = await fetch("/api/projects", { credentials: "include" });
        if (!res.ok) return;
        const json = await res.json();
        const items = json.data || json.projects || json; // adapt if needed
        // insert each project room
        items.forEach((p) => {
          const roomName = `project:${p._id}`;
          if (rooms.has(roomName)) return;
          const label = p.name || `Project ${String(p._id).slice(0, 6)}`;
          const el = createThreadEl(roomName, label);
          threadList.appendChild(el);
          rooms.set(roomName, { el, unread: 0 });
        });
      } catch (err) {
        console.warn("loadProjects failed", err);
      }
    }

    // add global room entry if missing
    // function ensureGlobal() {
    //   const globalRoom = 'global';
    //   if (!rooms.has(globalRoom)) {
    //     const el = createThreadEl(globalRoom, `# ${ROOM}`); // ROOM from top-level
    //     el.classList.add('active'); // default active
    //     threadList.insertBefore(el, threadList.firstChild);
    //     rooms.set(globalRoom, { el, unread: 0 });
    //   }
    // }

    function ensureGlobal() {
      const globalRoom = "global";
      if (threadList.querySelector(`[data-room="${globalRoom}"]`)) {
        // already present in DOM — mark active if matches ROOM
        const el = threadList.querySelector(`[data-room="${ROOM}"]`);
        if (el) el.classList.add("active");
        return;
      }
      // otherwise create element
      const el = createThreadEl(globalRoom, `# ${ROOM}`);
      el.classList.add("active");
      threadList.insertBefore(el, threadList.firstChild);
      rooms.set(globalRoom, { el, unread: 0 });
    }

    // search filter
    if (threadSearch) {
      threadSearch.addEventListener("input", () => {
        const q = (threadSearch.value || "").toLowerCase().trim();
        rooms.forEach(({ el }) => {
          const text = el.innerText.toLowerCase();
          el.style.display = text.includes(q) ? "" : "none";
        });
      });
    }

    // new room quick action (prompt user for name); you'll probably want a nicer modal later
    if (btnNewRoom) {
      btnNewRoom.addEventListener("click", async () => {
        const name = prompt(
          "Create new room name (e.g. team:design or project:<id>):"
        );
        if (!name) return;
        const roomName = name.trim();
        if (rooms.has(roomName)) {
          rooms.get(roomName).el.click();
          return;
        }
        const el = createThreadEl(roomName, roomName);
        threadList.appendChild(el);
        rooms.set(roomName, { el, unread: 0 });
        // join immediately
        socket.emit("join", roomName);
        el.classList.add("active");
      });
    }

    // handle incoming messages -> increment unread for rooms not active
    socket.on("chat:message", (m) => {
      try {
        // server messages may include a 'room' property or you may track it differently
        const room =
          m.room ||
          m.roomName ||
          (m.projectId ? `project:${m.projectId}` : "global");
        if (!room) return;
        const r = rooms.get(room);
        const active =
          document.querySelector(".thread-item.active")?.dataset.room ||
          "global";
        if (!r) return;
        if (active !== room) {
          r.unread = (r.unread || 0) + 1;
          const badge = r.el.querySelector(".unread-badge");
          if (badge) {
            badge.textContent = String(r.unread);
            badge.classList.remove("d-none");
          }
        }
        // update last-time text
        const lastTimeEl = r.el.querySelector(".last-time");
        if (lastTimeEl)
          lastTimeEl.textContent = new Date().toLocaleTimeString();
      } catch (err) {
        /* ignore */
      }
    });

    // ensure global present, then load projects
    ensureGlobal();
    loadProjects();
  })();
})();
