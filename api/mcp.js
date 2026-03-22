const Imap = require("imap");
const { simpleParser } = require("mailparser");

// ── Auth ────────────────────────────────────────────────────────────────────
function checkAuth(req) {
  const expected = process.env.POKE_API_KEY;
  if (!expected) return true;
  const auth   = req.headers["authorization"] || "";
  const xapi   = req.headers["x-api-key"] || "";
  const url    = new URL(req.url, "https://placeholder");
  const qparam = url.searchParams.get("key") || "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === expected) return true;
  if (xapi === expected) return true;
  if (qparam === expected) return true;
  return false;
}

// ── IMAP helpers ────────────────────────────────────────────────────────────────
const IMAP_CFG = {
  user:        process.env.IMAP_USER     || "",
  password:    process.env.IMAP_PASSWORD || "",
  host:        process.env.IMAP_HOST     || "imap.mail.me.com",
  port:        parseInt(process.env.IMAP_PORT || "993"),
  tls:         true,
  tlsOptions:  { rejectUnauthorized: false },
  connTimeout: 30000,
  authTimeout: 15000,
};

async function connectAndOpen(mailbox, readOnly = true) {
  return new Promise((resolve, reject) => {
    const imap = new Imap(IMAP_CFG);
    imap.once("ready", () => {
      imap.openBox(mailbox || "INBOX", readOnly, (err, box) => {
        if (err) { imap.end(); return reject(err); }
        resolve({ imap, box });
      });
    });
    imap.once("error", reject);
    imap.connect();
  });
}

async function imapSearch(imap, criteria) {
  return new Promise((res, rej) => imap.search(criteria, (e, r) => e ? rej(e) : res(r || [])));
}

async function fetchHeaders(imap, uids) {
  return new Promise((resolve, reject) => {
    if (!uids.length) return resolve([]);
    const rows = [], pending = [];
    const f = imap.fetch(uids, { bodies: "HEADER.FIELDS (FROM SUBJECT DATE)", struct: false });
    f.on("message", msg => {
      let attrs = {}; const chunks = [];
      msg.on("body", s => s.on("data", c => chunks.push(c)));
      msg.once("attributes", a => { attrs = a; });
      msg.once("end", () => pending.push(
        simpleParser(Buffer.concat(chunks)).then(p => rows.push({
          uid: attrs.uid, subject: p.subject || "(no subject)",
          from: p.from?.text || "", date: p.date?.toISOString() || "",
          flags: attrs.flags || [],
        })).catch(() => {})
      ));
    });
    f.once("error", reject);
    f.once("end", async () => { await Promise.all(pending); resolve(rows); });
  });
}

async function fetchFull(imap, uid) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const f = imap.fetch([uid], { bodies: "", struct: true });
    f.on("message", msg => msg.on("body", s => s.on("data", c => chunks.push(c))));
    f.once("error", reject);
    f.once("end", () => simpleParser(Buffer.concat(chunks)).then(resolve).catch(reject));
  });
}

async function getBoxes(imap) {
  return new Promise((res, rej) => imap.getBoxes((e, b) => e ? rej(e) : res(b)));
}

function flattenBoxes(boxes, prefix = "") {
  const out = [];
  for (const [n, b] of Object.entries(boxes)) {
    const full = prefix ? `${prefix}${b.delimiter || "/"}${n}` : n;
    out.push(full);
    if (b.children) out.push(...flattenBoxes(b.children, full));
  }
  return out;
}

async function imapMoveUids(imap, uids, destination) {
  return new Promise((resolve, reject) => {
    imap.move(uids, destination, (err) => { if (err) reject(err); else resolve(); });
  });
}

// ── Tools ───────────────────────────────────────────────────────────────────
const TOOLS = [
  { name: "list_mailboxes", description: "List all mailboxes/folders in the iCloud email account", inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "list_emails", description: "List recent emails from a mailbox (UID, subject, from, date)", inputSchema: { type: "object", properties: { mailbox: { type: "string", description: "Folder name (default: INBOX)" }, limit: { type: "number", description: "Max emails, default 10, max 50" }, unseen_only: { type: "boolean", description: "Only return unread emails" } } } },
  { name: "get_email", description: "Get the full content of an email by UID", inputSchema: { type: "object", properties: { uid: { type: "number", description: "Email UID" }, mailbox: { type: "string", description: "Folder name (default: INBOX)" } }, required: ["uid"] } },
  { name: "search_emails", description: "Search emails by subject, sender, or date", inputSchema: { type: "object", properties: { mailbox: { type: "string", description: "Folder to search (default: INBOX)" }, subject: { type: "string", description: "Search subject" }, from: { type: "string", description: "Search sender" }, since: { type: "string", description: "Emails since date string" }, limit: { type: "number", description: "Max results, default 10" } } } },
  { name: "get_mailbox_status", description: "Get total and unread message counts for a mailbox", inputSchema: { type: "object", properties: { mailbox: { type: "string", description: "Folder name (default: INBOX)" } } } },
  { name: "archive_email", description: "Archive an email by moving it to the Archive folder", inputSchema: { type: "object", properties: { uid: { type: "number", description: "Email UID to archive" }, mailbox: { type: "string", description: "Source folder (default: INBOX)" } }, required: ["uid"] } },
  { name: "move_email", description: "Move an email from one folder to another", inputSchema: { type: "object", properties: { uid: { type: "number", description: "Email UID to move" }, mailbox: { type: "string", description: "Source folder (default: INBOX)" }, destination: { type: "string", description: "Destination folder (e.g. Junk, Trash, Archive, Sent Messages)" } }, required: ["uid", "destination"] } },
];

async function callTool(name, args) {
  args = args || {};
  if (name === "list_mailboxes") {
    const imap = new Imap(IMAP_CFG);
    const boxes = await new Promise((res, rej) => {
      imap.once("ready", () => getBoxes(imap).then(b => { imap.end(); res(b); }).catch(rej));
      imap.once("error", rej);
      imap.connect();
    });
    const names = flattenBoxes(boxes);
    return { content: [{ type: "text", text: `Mailboxes (${names.length}):\n${names.join("\n")}` }] };
  }
  if (name === "list_emails") {
    const { imap } = await connectAndOpen(args.mailbox || "INBOX");
    try {
      const uids = await imapSearch(imap, args.unseen_only ? ["UNSEEN"] : ["ALL"]);
      const recent = uids.slice(-Math.min(args.limit || 10, 50));
      if (!recent.length) return { content: [{ type: "text", text: "No emails found." }] };
      const emails = await fetchHeaders(imap, recent);
      const lines = emails.map(e => `UID:${e.uid} | ${e.date} | From: ${e.from} | Subject: ${e.subject}${e.flags.includes("\\Seen") ? "" : " [UNREAD]"}`);
      return { content: [{ type: "text", text: `${lines.length} email(s):\n${lines.join("\n")}` }] };
    } finally { imap.end(); }
  }
  if (name === "get_email") {
    if (!args.uid) return { content: [{ type: "text", text: "uid is required" }], isError: true };
    const { imap } = await connectAndOpen(args.mailbox || "INBOX");
    try {
      const p = await fetchFull(imap, args.uid);
      const text = [`From: ${p.from?.text || ""}`, `To: ${p.to?.text || ""}`, `Date: ${p.date?.toISOString() || ""}`, `Subject: ${p.subject || "(no subject)"}`, `Attachments: ${p.attachments?.length || 0}`, "", (p.text || (p.html ? "[HTML content]" : "(empty body)")).substring(0, 4000)].join("\n");
      return { content: [{ type: "text", text }] };
    } finally { imap.end(); }
  }
  if (name === "search_emails") {
    const { imap } = await connectAndOpen(args.mailbox || "INBOX");
    try {
      const criteria = [];
      if (args.subject) criteria.push(["SUBJECT", args.subject]);
      if (args.from)    criteria.push(["FROM",    args.from]);
      if (args.since)   criteria.push(["SINCE",   args.since]);
      if (!criteria.length) criteria.push("ALL");
      const uids = await imapSearch(imap, criteria);
      const recent = uids.slice(-Math.min(args.limit || 10, 50));
      if (!recent.length) return { content: [{ type: "text", text: "No matching emails found." }] };
      const emails = await fetchHeaders(imap, recent);
      const lines = emails.map(e => `UID:${e.uid} | ${e.date} | From: ${e.from} | Subject: ${e.subject}`);
      return { content: [{ type: "text", text: `Found ${uids.length} match(es), showing ${recent.length}:\n${lines.join("\n")}` }] };
    } finally { imap.end(); }
  }
  if (name === "get_mailbox_status") {
    const { imap, box } = await connectAndOpen(args.mailbox || "INBOX");
    try {
      const unseen = await imapSearch(imap, ["UNSEEN"]);
      return { content: [{ type: "text", text: `Mailbox: ${args.mailbox || "INBOX"}\nTotal: ${box.messages.total}\nUnread: ${unseen.length}` }] };
    } finally { imap.end(); }
  }
  if (name === "archive_email") {
    if (!args.uid) return { content: [{ type: "text", text: "uid is required" }], isError: true };
    const source = args.mailbox || "INBOX";
    const listImap = new Imap(IMAP_CFG);
    const boxes = await new Promise((res, rej) => {
      listImap.once("ready", () => getBoxes(listImap).then(b => { listImap.end(); res(b); }).catch(rej));
      listImap.once("error", rej);
      listImap.connect();
    });
    const allBoxes = flattenBoxes(boxes);
    const archiveFolder = allBoxes.find(b => b === "Archive") || allBoxes.find(b => b.toLowerCase() === "archive") || allBoxes.find(b => b.toLowerCase().startsWith("archive")) || "Archive";
    const { imap } = await connectAndOpen(source, false);
    try {
      await imapMoveUids(imap, [args.uid], archiveFolder);
      return { content: [{ type: "text", text: `UID ${args.uid} archived to "${archiveFolder}"` }] };
    } finally { imap.end(); }
  }
  if (name === "move_email") {
    if (!args.uid)         return { content: [{ type: "text", text: "uid is required" }], isError: true };
    if (!args.destination) return { content: [{ type: "text", text: "destination is required" }], isError: true };
    const source = args.mailbox || "INBOX";
    const listImap = new Imap(IMAP_CFG);
    const boxes = await new Promise((res, rej) => {
      listImap.once("ready", () => getBoxes(listImap).then(b => { listImap.end(); res(b); }).catch(rej));
      listImap.once("error", rej);
      listImap.connect();
    });
    const allBoxes = flattenBoxes(boxes);
    const dest = allBoxes.find(b => b.toLowerCase() === args.destination.toLowerCase()) || args.destination;
    const { imap } = await connectAndOpen(source, false);
    try {
      await imapMoveUids(imap, [args.uid], dest);
      return { content: [{ type: "text", text: `UID ${args.uid} moved from "${source}" to "${dest}"` }] };
    } finally { imap.end(); }
  }
  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key, Mcp-Session-Id");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!checkAuth(req)) return res.status(401).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized: missing or invalid API key" } });
  if (req.method === "GET")    return res.status(200).json({ name: "icloud-email-mcp", version: "1.1.0", status: "ok" });
  if (req.method !== "POST")   return res.status(405).end();
  let body = req.body;
  if (!body) {
    const raw = await new Promise(resolve => { const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => resolve(Buffer.concat(chunks).toString())); });
    try { body = JSON.parse(raw); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  }
  const { method, id, params } = body;
  const respond  = r      => res.status(200).json({ jsonrpc: "2.0", id, result: r });
  const mcpError = (c, m) => res.status(200).json({ jsonrpc: "2.0", id, error: { code: c, message: m } });
  if (method === "initialize")               return respond({ protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "icloud-email-mcp", version: "1.1.0" } });
  if (method === "notifications/initialized") return res.status(200).end();
  if (method === "tools/list")               return respond({ tools: TOOLS });
  if (method === "ping")                     return respond({});
  if (method === "tools/call") {
    const { name, arguments: args } = params || {};
    try { return respond(await callTool(name, args)); }
    catch (err) { return respond({ content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }); }
  }
  return mcpError(-32601, `Method not found: ${method}`);
};
