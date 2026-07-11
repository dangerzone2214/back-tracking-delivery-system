const DB_NAME = "bt-delivery-reporting";
const DB_VERSION = 1;
const API_BASE = localStorage.getItem("bt_agent_api_base") || window.BACK_TRACKING_API_BASE || "";
const TOKEN_KEY = "bt_agent_token";
const USER_KEY = "bt_agent_user";

let db;
let records = [];
let authToken = localStorage.getItem(TOKEN_KEY) || "";
let authUser = JSON.parse(localStorage.getItem(USER_KEY) || "null");
let localRecordsLoaded = false;
let authMode = "login";

const els = {
  loginScreen: document.querySelector("#loginScreen"),
  agentApp: document.querySelector("#agentApp"),
  authCopy: document.querySelector("#authCopy"),
  showLoginBtn: document.querySelector("#showLoginBtn"),
  showRegisterBtn: document.querySelector("#showRegisterBtn"),
  usernameInput: document.querySelector("#usernameInput"),
  passwordInput: document.querySelector("#passwordInput"),
  confirmPasswordLabel: document.querySelector("#confirmPasswordLabel"),
  confirmPasswordInput: document.querySelector("#confirmPasswordInput"),
  loginBtn: document.querySelector("#loginBtn"),
  registerBtn: document.querySelector("#registerBtn"),
  loginNote: document.querySelector("#loginNote"),
  logoutBtn: document.querySelector("#logoutBtn"),
  searchInput: document.querySelector("#searchInput"),
  searchBtn: document.querySelector("#searchBtn"),
  metrics: document.querySelector("#metrics"),
  rtsWarning: document.querySelector("#rtsWarning"),
  resultCount: document.querySelector("#resultCount"),
  resultsBody: document.querySelector("#resultsBody"),
  sourceNote: document.querySelector("#sourceNote"),
};

init();

async function init() {
  renderEmptyMetrics();
  els.resultsBody.innerHTML = emptyRow("Type at least 2 characters to search.");
  bindEvents();
  applyAuthState();

  if (API_BASE) {
    return;
  }

  if (authToken) {
    await loadLocalRecords();
  }
}

function bindEvents() {
  els.loginBtn.addEventListener("click", login);
  els.registerBtn.addEventListener("click", register);
  els.showLoginBtn.addEventListener("click", () => setAuthMode("login"));
  els.showRegisterBtn.addEventListener("click", () => setAuthMode("register"));
  els.passwordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitAuth();
  });
  els.confirmPasswordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitAuth();
  });
  els.logoutBtn.addEventListener("click", logout);
  els.searchBtn.addEventListener("click", search);
  els.searchInput.addEventListener("input", debounce(search, 180));
}

function setAuthMode(mode) {
  authMode = mode;
  const isRegister = mode === "register";
  els.showLoginBtn.classList.toggle("active", !isRegister);
  els.showRegisterBtn.classList.toggle("active", isRegister);
  els.loginBtn.classList.toggle("hidden", isRegister);
  els.registerBtn.classList.toggle("hidden", !isRegister);
  els.confirmPasswordLabel.classList.toggle("hidden", !isRegister);
  els.authCopy.textContent = isRegister
    ? "Create an agent account before using the search portal."
    : "Login muna bago makita ang agent search portal.";
  els.loginNote.textContent = isRegister
    ? "Use your agent username and password."
    : "Login using your assigned agent account.";
}

function submitAuth() {
  if (authMode === "register") register();
  else login();
}

function applyAuthState() {
  const loggedIn = Boolean(authToken);
  els.loginScreen.classList.toggle("hidden", loggedIn);
  els.agentApp.classList.toggle("hidden", !loggedIn);
  els.logoutBtn.classList.toggle("hidden", !loggedIn);
  els.searchInput.disabled = !loggedIn;
  els.searchBtn.disabled = !loggedIn;
  if (!loggedIn) {
    els.loginNote.textContent = API_BASE
      ? "Login using your assigned agent account."
      : "Local preview only. Live registration works after backend is connected.";
    return;
  }
  els.sourceNote.textContent = API_BASE
    ? `Logged in as ${authUser?.username || "agent"} | Connected to backend API.`
    : `Logged in as ${authUser?.username || "agent"} | Reading local synced data.`;
}

async function register() {
  const username = els.usernameInput.value.trim().toLowerCase();
  const password = els.passwordInput.value;
  const confirmPassword = els.confirmPasswordInput.value;
  if (!username || !password || !confirmPassword) {
    els.loginNote.textContent = "Complete username, password, and confirm password.";
    return;
  }
  if (password !== confirmPassword) {
    els.loginNote.textContent = "Passwords do not match.";
    return;
  }
  if (!API_BASE) {
    els.loginNote.textContent = "Register needs the live backend. Deploy/connect Render API first.";
    return;
  }
  try {
    els.loginNote.textContent = "Creating account...";
    const response = await fetch(`${API_BASE.replace(/\/$/, "")}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Registration failed.");
    els.confirmPasswordInput.value = "";
    els.passwordInput.value = "";
    setAuthMode("login");
    els.loginNote.textContent = "Account created. Please wait for admin approval before logging in.";
  } catch (error) {
    els.loginNote.textContent = error.message || "Registration failed.";
  }
}

async function login() {
  const username = els.usernameInput.value.trim().toLowerCase();
  const password = els.passwordInput.value;
  if (!username || !password) {
    els.loginNote.textContent = "Enter username and password.";
    return;
  }

  if (!API_BASE) {
    authToken = "local-agent-preview";
    authUser = { username, role: "agent" };
    localStorage.setItem(TOKEN_KEY, authToken);
    localStorage.setItem(USER_KEY, JSON.stringify(authUser));
    els.passwordInput.value = "";
    applyAuthState();
    els.loginNote.textContent = "Login successful.";
    await loadLocalRecords();
    return;
  }

  try {
    els.loginNote.textContent = "Logging in...";
    const response = await fetch(`${API_BASE.replace(/\/$/, "")}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Login failed.");
    authToken = payload.token;
    authUser = payload.user;
    localStorage.setItem(TOKEN_KEY, authToken);
    localStorage.setItem(USER_KEY, JSON.stringify(authUser));
    els.passwordInput.value = "";
    els.loginNote.textContent = "Login successful.";
    applyAuthState();
  } catch (error) {
    authToken = "";
    authUser = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    els.loginNote.textContent = error.message || "Login failed.";
    applyAuthState();
  }
}

function logout() {
  authToken = "";
  authUser = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  renderEmptyMetrics();
  els.resultCount.textContent = "0 records";
  els.resultsBody.innerHTML = emptyRow("Login first to search.");
  applyAuthState();
}

async function search() {
  if (!authToken) {
    applyAuthState();
    els.loginNote.textContent = "Login first to search.";
    return;
  }
  if (!API_BASE && !localRecordsLoaded) {
    await loadLocalRecords();
  }
  const terms = searchTerms(els.searchInput.value);
  if (!terms.length) {
    renderEmptyMetrics();
    els.resultCount.textContent = "0 records";
    els.resultsBody.innerHTML = emptyRow("Type at least 2 characters. You can paste many CP numbers or waybills at once.");
    renderRtsWarning(0, 0, 0);
    return;
  }

  if (API_BASE) {
    if (!authToken) {
      els.resultsBody.innerHTML = emptyRow("Login first to search.");
      return;
    }
    await searchBackend(terms);
    return;
  }

  const matches = records.filter((record) => {
    return terms.some((term) => {
      const textMatch = record._searchText.includes(term.text);
      const digitMatch = term.digits.length >= 2 && record._searchDigits.includes(term.digits);
      return textMatch || digitMatch;
    });
  }).slice(0, 500);

  renderResults(matches, summarize(matches), records.length ? "No matching records." : "No local synced records found. Sync data in the admin page first.");
}

async function loadLocalRecords() {
  if (localRecordsLoaded) return;
  els.sourceNote.textContent = "Reading local synced data...";
  db = await openDb();
  records = (await getAllRecords()).map(prepareRecord);
  localRecordsLoaded = true;
  els.sourceNote.textContent = `Reading local synced data: ${numberFormat(records.length)} records available.`;
}

async function searchBackend(terms) {
  try {
    els.sourceNote.textContent = "Searching backend database...";
    const allRows = [];
    const seen = new Set();
    for (const term of terms.slice(0, 30)) {
      const response = await fetch(`${API_BASE.replace(/\/$/, "")}/api/search?q=${encodeURIComponent(term.text || term.digits)}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Backend search failed");
      for (const row of payload.rows || []) {
        const id = row.id || `${row.waybill_number}-${row.receiver_cellphone}`;
        if (seen.has(id)) continue;
        seen.add(id);
        allRows.push(row);
      }
    }
    renderResults(allRows, summarize(allRows), "No matching records.");
    els.sourceNote.textContent = `Connected to backend API: ${API_BASE}`;
  } catch (error) {
    if (String(error.message || "").toLowerCase().includes("login") || String(error.message || "").toLowerCase().includes("unauthorized")) {
      logout();
    }
    renderEmptyMetrics();
    els.resultCount.textContent = "0 records";
    els.resultsBody.innerHTML = emptyRow(error.message || "Backend search failed.");
    els.sourceNote.textContent = "Backend connection failed.";
  }
}

function searchTerms(value) {
  const normalized = String(value || "")
    .split(/[\s,;|]+/)
    .map((term) => term.trim())
    .filter(Boolean);
  const terms = normalized.length ? normalized : [String(value || "").trim()].filter(Boolean);
  const unique = new Map();
  terms.forEach((term) => {
    const text = normalizeText(term);
    const digits = digitsOnly(term);
    if (text.length >= 2 || digits.length >= 2) unique.set(text || digits, { text, digits });
  });
  return [...unique.values()];
}

function renderResults(rows, summary, emptyMessage) {
  els.metrics.innerHTML = [
    ["Orders", numberFormat(summary.total)],
    ["Delivered", numberFormat(summary.delivered)],
    ["Delivery Rate", `${summary.deliveryRate}%`],
    ["RTS Count", numberFormat(summary.rts)],
    ["RTS Rate", `${summary.rtsRate}%`],
    ["Risk", riskLabel(summary.total, summary.rtsRate)],
  ].map(metricCard).join("");
  renderRtsWarning(summary.total, summary.rts, summary.rtsRate);
  els.resultCount.textContent = `${numberFormat(rows.length)} records`;
  els.resultsBody.innerHTML = rows.length ? rows.map(rowHtml).join("") : emptyRow(emptyMessage);
}

function renderEmptyMetrics() {
  els.metrics.innerHTML = [
    ["Orders", "0"],
    ["Delivered", "0"],
    ["Delivery Rate", "0%"],
    ["RTS Count", "0"],
    ["RTS Rate", "0%"],
    ["Risk", "-"],
  ].map(metricCard).join("");
}

function renderRtsWarning(total, rtsCount, rtsRate) {
  if (total < 3 || rtsRate < 20) {
    els.rtsWarning.classList.add("hidden");
    els.rtsWarning.innerHTML = "";
    return;
  }
  const level = rtsRate >= 40 ? "High RTS warning" : "RTS watchlist";
  els.rtsWarning.classList.remove("hidden");
  els.rtsWarning.innerHTML = `<strong>${level}:</strong> ${numberFormat(rtsCount)} of ${numberFormat(total)} orders are RTS/return (${rtsRate}%). Review this customer before sending new deliveries.`;
}

function rowHtml(record) {
  const status = record.normalized_status || record.normalizedStatus || record.status || "other";
  const orderStatus = record.order_status || record.orderStatus || record.statusLabel || "-";
  return `
    <tr>
      <td>${escapeHtml(record.creator_code || record.creatorCode || "-")}</td>
      <td>${escapeHtml(record.waybill_number || record.waybillNumber || record.tracking || "-")}</td>
      <td><span class="badge ${escapeHtml(status)}">${escapeHtml(orderStatus)}</span></td>
      <td>${escapeHtml(record.signing_time || record.signingTime || record.orderDate || "-")}</td>
      <td>${escapeHtml(record.receiver || record.customer || "-")}</td>
      <td>${escapeHtml(record.receiver_cellphone || record.receiverCellphone || record.mobile || "-")}</td>
      <td>${escapeHtml(record.submission_time || record.submissionTime || "-")}</td>
      <td>${escapeHtml(record.remarks || record.product || "-")}</td>
      <td>${escapeHtml(record.sender_name || record.senderName || record.courier || "-")}</td>
    </tr>
  `;
}

function summarize(rows) {
  const total = rows.length;
  let delivered = 0;
  let rts = 0;
  for (const record of rows) {
    const status = record.normalized_status || record.normalizedStatus || record.status || "other";
    if (status === "delivered") delivered += 1;
    if (status === "return" || status === "for-return") rts += 1;
  }
  return {
    total,
    delivered,
    rts,
    deliveryRate: total ? Math.round((delivered / total) * 100) : 0,
    rtsRate: total ? Math.round((rts / total) * 100) : 0,
  };
}

function backendSummary(summary = {}) {
  return {
    total: Number(summary.total) || 0,
    delivered: Number(summary.delivered) || 0,
    rts: Number(summary.rts) || 0,
    deliveryRate: Number(summary.deliveryRate) || 0,
    rtsRate: Number(summary.rtsRate) || 0,
  };
}

function prepareRecord(record) {
  record._searchText = normalizeText([
    record.search,
    record.rawSearch,
    record.creatorCode,
    record.waybillNumber,
    record.orderStatus,
    record.signingTime,
    record.receiver,
    record.receiverCellphone,
    record.submissionTime,
    record.remarks,
    record.senderName,
    record.customer,
    record.mobile,
    record.tracking,
    record.product,
  ].join(" "));
  record._searchDigits = digitsOnly([
    record.rawDigits,
    record.digits,
    record.receiverCellphone,
    record.mobile,
    record.waybillNumber,
    record.tracking,
  ].join(" "));
  return record;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("records")) {
        const store = database.createObjectStore("records", { keyPath: "id" });
        store.createIndex("sheetKey", "sheetKey", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllRecords(limit = 1000000) {
  return new Promise((resolve, reject) => {
    const request = db.transaction("records").objectStore("records").getAll(null, limit);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function metricCard([label, value]) {
  return `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`;
}

function emptyRow(message) {
  return `<tr><td colspan="9">${escapeHtml(message)}</td></tr>`;
}

function riskLabel(total, rtsRate) {
  if (total < 3) return "-";
  if (rtsRate >= 40) return "High";
  if (rtsRate >= 20) return "Watch";
  return "Normal";
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function numberFormat(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function debounce(fn, wait) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), wait);
  };
}
