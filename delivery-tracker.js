const APP_KEY = "bt_drs_settings_v1";
const DB_NAME = "bt-delivery-reporting";
const DB_VERSION = 1;
const API_BASE = localStorage.getItem("bt_admin_api_base") || window.BACK_TRACKING_API_BASE || "";
const ADMIN_TOKEN_KEY = "bt_admin_token";
const ADMIN_USER_KEY = "bt_admin_user";
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const STATUS = {
  delivered: "Delivered",
  transit: "In Transit",
  ofd: "Out for Delivery",
  return: "Return",
  "for-return": "For Return",
  pending: "Pending",
  other: "Other",
};
const COLORS = {
  delivered: "#58c98f",
  transit: "#65a8e8",
  ofd: "#e0b25a",
  return: "#ef766b",
  "for-return": "#f19188",
  pending: "#a99af0",
  other: "#9ca9a5",
};

let db;
let state = {
  view: "dashboard",
  settings: loadSettings(),
  records: [],
  dashboardRecords: [],
  productsDirty: true,
  autoSyncTried: false,
  adminToken: localStorage.getItem(ADMIN_TOKEN_KEY) || "",
  adminUser: JSON.parse(localStorage.getItem(ADMIN_USER_KEY) || "null"),
};

const $ = (selector) => document.querySelector(selector);
const els = {
  app: $("#app"),
  adminLoginScreen: $("#adminLoginScreen"),
  nav: $("#nav"),
  pageKicker: $("#pageKicker"),
  pageTitle: $("#pageTitle"),
  themeBtn: $("#themeBtn"),
  adminAuth: $("#adminAuth"),
  adminUsername: $("#adminUsername"),
  adminPassword: $("#adminPassword"),
  adminLoginBtn: $("#adminLoginBtn"),
  adminLoginNote: $("#adminLoginNote"),
  adminCurrentUser: $("#adminCurrentUser"),
  adminLogoutBtn: $("#adminLogoutBtn"),
  syncAllBtn: $("#syncAllBtn"),
  dashboardYear: $("#dashboardYear"),
  dashboardMonth: $("#dashboardMonth"),
  dashboardStatus: $("#dashboardStatus"),
  metrics: $("#metrics"),
  statusChart: $("#statusChart"),
  trendChart: $("#trendChart"),
  statusChartLabel: $("#statusChartLabel"),
  trendLabel: $("#trendLabel"),
  recentBody: $("#recentBody"),
  sheetYear: $("#sheetYear"),
  loadYearBtn: $("#loadYearBtn"),
  saveSheetsBtn: $("#saveSheetsBtn"),
  monthGrid: $("#monthGrid"),
  sheetHelp: $("#sheetHelp"),
  syncVisibleYearBtn: $("#syncVisibleYearBtn"),
  syncSummary: $("#syncSummary"),
  syncList: $("#syncList"),
  searchInput: $("#searchInput"),
  searchBtn: $("#searchBtn"),
  customerMetrics: $("#customerMetrics"),
  rtsWarning: $("#rtsWarning"),
  searchCount: $("#searchCount"),
  searchBody: $("#searchBody"),
  productBody: $("#productBody"),
  productCount: $("#productCount"),
  exportCsvBtn: $("#exportCsvBtn"),
  printReportBtn: $("#printReportBtn"),
  backupBtn: $("#backupBtn"),
  restoreInput: $("#restoreInput"),
  clearDbBtn: $("#clearDbBtn"),
  dbStatus: $("#dbStatus"),
  settingsGrid: $("#settingsGrid"),
  agentAccountCount: $("#agentAccountCount"),
  agentAccountsBody: $("#agentAccountsBody"),
  agentLoginCount: $("#agentLoginCount"),
  agentLoginsBody: $("#agentLoginsBody"),
  clearLogsBtn: $("#clearLogsBtn"),
  logs: $("#logs"),
};

init();

async function init() {
  db = await openDb();
  state.settings.theme = "light";
  saveSettings();
  document.body.classList.toggle("light", state.settings.theme === "light");
  els.themeBtn.textContent = state.settings.theme === "light" ? "Dark Mode" : "Light Mode";
  if (location.protocol === "file:" && els.sheetHelp) {
    els.sheetHelp.textContent = "Local file preview is for checking the dashboard only. Normal Google Sheet links connect after deploying to Netlify with GOOGLE_SHEETS_API_KEY.";
  }
  setupStaticSelects();
  bindEvents();
  applyAdminAuthState();
  await refreshAll();
}

function defaultSettings() {
  const year = new Date().getFullYear();
  return { currentYear: year, sheets: {}, logs: [], theme: "light" };
}

function loadSettings() {
  try {
    return { ...defaultSettings(), ...(JSON.parse(localStorage.getItem(APP_KEY)) || {}) };
  } catch {
    return defaultSettings();
  }
}

function saveSettings() {
  localStorage.setItem(APP_KEY, JSON.stringify(state.settings));
}

function applyAdminAuthState() {
  const loggedIn = Boolean(state.adminToken && state.adminUser?.role === "admin");
  els.adminLoginScreen?.classList.toggle("hidden", loggedIn);
  els.app?.classList.toggle("hidden", !loggedIn);
  els.adminAuth?.classList.toggle("hidden", !loggedIn);
  els.adminLogoutBtn?.classList.toggle("hidden", !loggedIn);
  if (els.adminCurrentUser) {
    els.adminCurrentUser.textContent = loggedIn ? `Admin: ${state.adminUser?.username || "admin"}` : "Admin";
  }
  if (!loggedIn && els.adminLoginNote) {
    els.adminLoginNote.textContent = API_BASE
      ? "Admin account required."
      : "Local preview: use username admin and any password.";
  }
}

async function adminLogin() {
  const username = els.adminUsername.value.trim().toLowerCase();
  const password = els.adminPassword.value;
  if (!username || !password) {
    alert("Enter admin username and password.");
    return;
  }
  if (!API_BASE) {
    if (username !== "admin") {
      alert("Local preview accepts admin username only.");
      return;
    }
    state.adminToken = "local-admin-preview";
    state.adminUser = { username: "admin", role: "admin" };
    localStorage.setItem(ADMIN_TOKEN_KEY, state.adminToken);
    localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(state.adminUser));
    els.adminPassword.value = "";
    applyAdminAuthState();
    return;
  }
  const response = await fetch(`${API_BASE.replace(/\/$/, "")}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const payload = await response.json();
  if (!response.ok) {
    alert(payload.error || "Login failed.");
    return;
  }
  if (payload.user?.role !== "admin") {
    alert("Admin account required.");
    return;
  }
  state.adminToken = payload.token;
  state.adminUser = payload.user;
  localStorage.setItem(ADMIN_TOKEN_KEY, state.adminToken);
  localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(state.adminUser));
  els.adminPassword.value = "";
  applyAdminAuthState();
  if (state.view === "settings") renderSettings();
}

function adminLogout() {
  state.adminToken = "";
  state.adminUser = null;
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_USER_KEY);
  applyAdminAuthState();
  if (state.view === "settings") renderSettings();
}

async function backendRequest(path, options = {}) {
  if (!API_BASE) throw new Error("Backend API is not configured.");
  if (!state.adminToken) throw new Error("Admin login required.");
  const response = await fetch(`${API_BASE.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.adminToken}`,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(payload?.error || "Backend request failed.");
  return payload;
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const records = database.createObjectStore("records", { keyPath: "id" });
      records.createIndex("yearMonth", ["year", "month"], { unique: false });
      records.createIndex("sheetKey", "sheetKey", { unique: false });
      records.createIndex("search", "search", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(store, mode = "readonly") {
  return db.transaction(store, mode).objectStore(store);
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllRecords(limit = 1000000) {
  const store = tx("records");
  const records = await requestToPromise(store.getAll(null, limit));
  return records.map(prepareRecord);
}

async function getRecordsBySheet(sheetKey) {
  const index = tx("records").index("sheetKey");
  return requestToPromise(index.getAll(sheetKey));
}

async function replaceSheetRecords(sheetKey, records) {
  const transaction = db.transaction("records", "readwrite");
  const store = transaction.objectStore("records");
  const index = store.index("sheetKey");
  await new Promise((resolve, reject) => {
    const request = index.openCursor(IDBKeyRange.only(sheetKey));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        records.forEach((record) => store.put(record));
        return resolve();
      }
      cursor.delete();
      cursor.continue();
    };
  });
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function clearRecords() {
  await requestToPromise(tx("records", "readwrite").clear());
}

function bindEvents() {
  els.adminLoginBtn?.addEventListener("click", adminLogin);
  els.adminPassword?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") adminLogin();
  });
  els.adminLogoutBtn?.addEventListener("click", adminLogout);

  els.nav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (button) switchView(button.dataset.view);
  });

  els.themeBtn.addEventListener("click", () => {
    state.settings.theme = state.settings.theme === "light" ? "dark" : "light";
    saveSettings();
    document.body.classList.toggle("light", state.settings.theme === "light");
    els.themeBtn.textContent = state.settings.theme === "light" ? "Dark Mode" : "Light Mode";
    renderDashboard();
  });

  els.dashboardYear.addEventListener("change", () => {
    state.settings.currentYear = Number(els.dashboardYear.value);
    els.sheetYear.value = state.settings.currentYear;
    saveSettings();
    renderAll();
  });
  els.dashboardMonth.addEventListener("change", renderDashboard);
  els.dashboardStatus.addEventListener("change", renderDashboard);
  els.loadYearBtn.addEventListener("click", () => renderSheetManager(Number(els.sheetYear.value)));
  els.saveSheetsBtn.addEventListener("click", saveSheetInputs);
  els.syncAllBtn.addEventListener("click", () => syncYear(Number(els.sheetYear.value || state.settings.currentYear)));
  els.syncVisibleYearBtn.addEventListener("click", () => syncYear(Number(els.sheetYear.value || state.settings.currentYear)));
  els.searchBtn.addEventListener("click", renderSearch);
  els.searchInput.addEventListener("input", debounce(renderSearch, 180));
  els.exportCsvBtn.addEventListener("click", exportCsv);
  els.printReportBtn.addEventListener("click", () => window.print());
  els.backupBtn.addEventListener("click", backupSettings);
  els.restoreInput.addEventListener("change", restoreSettings);
  els.clearDbBtn.addEventListener("click", async () => {
    if (!confirm("Clear all synchronized internal records? Google Sheet links will stay saved.")) return;
    await clearRecords();
    Object.values(state.settings.sheets).forEach((year) => {
      Object.values(year).forEach((month) => Object.assign(month, { imported: 0, lastSync: "", status: "Not synced" }));
    });
    addLog("Cleared synchronized internal database");
    saveSettings();
    await refreshAll();
  });
  els.clearLogsBtn.addEventListener("click", () => {
    state.settings.logs = [];
    saveSettings();
    renderSettings();
  });
  els.agentAccountsBody?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-agent-action]");
    if (!button) return;
    const id = Number(button.dataset.agentId);
    const active = button.dataset.agentAction === "approve";
    await updateAgentApproval(id, active);
  });
}

function setupStaticSelects() {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 8 }, (_, index) => currentYear - 3 + index);
  [els.dashboardYear].forEach((select) => {
    select.innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join("");
    select.value = String(state.settings.currentYear);
  });
  els.sheetYear.value = state.settings.currentYear;
  const monthOptions = [`<option value="0">All Months</option>`, ...MONTHS.map((month, index) => `<option value="${index + 1}">${month}</option>`)];
  els.dashboardMonth.innerHTML = monthOptions.join("");
  els.dashboardStatus.innerHTML = [`<option value="">All Status</option>`, ...Object.entries(STATUS).map(([key, label]) => `<option value="${key}">${label}</option>`)].join("");
}

async function refreshAll() {
  state.records = await getAllRecords();
  state.productsDirty = true;
  renderAll();
}

function hasSavedSheetLinks(year) {
  const sheets = ensureYear(year);
  return Object.values(sheets).some((item) => item.url);
}

async function autoSyncCurrentYear() {
  const year = Number(els.sheetYear.value || state.settings.currentYear);
  addLog(`Auto-sync started for ${year}`);
  saveSettings();
  await syncYear(year);
}

function renderAll() {
  renderSheetManager(Number(els.sheetYear.value || state.settings.currentYear));
  renderDashboard();
  renderSyncList();
  renderSearch();
  if (state.view === "products") renderProducts();
  renderSettings();
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll("[data-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === view));
  els.nav.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const titles = {
    dashboard: ["Real-time delivery overview", "Dashboard"],
    sheets: ["Annual management", "Annual Google Sheets"],
    sync: ["Never display outdated information", "Synchronization"],
    search: ["Fast record lookup", "Customer History"],
    products: ["Product performance", "Product Reports"],
    reports: ["Export and print", "Reports"],
    settings: ["Database and logs", "Settings"],
  };
  els.pageKicker.textContent = titles[view][0];
  els.pageTitle.textContent = titles[view][1];
  if (view === "products") renderProducts();
  if (view === "settings") renderSettings();
}

function ensureYear(year) {
  if (!state.settings.sheets[year]) state.settings.sheets[year] = {};
  MONTHS.forEach((month, index) => {
    const number = index + 1;
    if (!state.settings.sheets[year][number]) {
      state.settings.sheets[year][number] = {
        month,
        url: "",
        status: "No link",
        sheetName: "",
        lastSync: "",
        imported: 0,
      };
    }
  });
  return state.settings.sheets[year];
}

function renderSheetManager(year) {
  els.sheetYear.value = year;
  const sheets = ensureYear(year);
  els.monthGrid.innerHTML = MONTHS.map((month, index) => {
    const number = index + 1;
    const item = sheets[number];
    const dot = item.url ? (item.imported ? "ok" : "warn") : "bad";
    return `
      <article class="month-card" data-month-card="${number}">
        <header>
          <div>
            <strong>${month}</strong>
            <span>${escapeHtml(item.sheetName || item.status || "No link")}</span>
          </div>
          <i class="status-dot ${dot}"></i>
        </header>
        <label>Google Sheet URL <input data-sheet-url="${number}" value="${escapeAttr(item.url || "")}" placeholder="Paste Google Sheet link" /></label>
        <span>Last Sync: ${item.lastSync ? new Date(item.lastSync).toLocaleString() : "Never"} | Records: ${numberFormat(item.imported || 0)}</span>
        <div class="month-actions">
          <button class="secondary" data-test-month="${number}" type="button">Test</button>
          <button data-sync-month="${number}" type="button">Sync</button>
          <button class="secondary danger" data-remove-month="${number}" type="button">Remove</button>
        </div>
      </article>
    `;
  }).join("");

  els.monthGrid.querySelectorAll("[data-test-month]").forEach((button) => button.addEventListener("click", () => testMonth(Number(els.sheetYear.value), Number(button.dataset.testMonth))));
  els.monthGrid.querySelectorAll("[data-sync-month]").forEach((button) => button.addEventListener("click", () => syncMonth(Number(els.sheetYear.value), Number(button.dataset.syncMonth))));
  els.monthGrid.querySelectorAll("[data-remove-month]").forEach((button) => button.addEventListener("click", () => removeMonth(Number(els.sheetYear.value), Number(button.dataset.removeMonth))));
}

async function saveSheetInputs() {
  const year = Number(els.sheetYear.value || state.settings.currentYear);
  const sheets = ensureYear(year);
  const saves = [];
  els.monthGrid.querySelectorAll("[data-sheet-url]").forEach((input) => {
    const month = input.dataset.sheetUrl;
    const url = input.value.trim();
    sheets[month].url = url;
    if (!url) Object.assign(sheets[month], { status: "No link", sheetName: "", imported: 0, lastSync: "" });
    if (API_BASE && url) {
      saves.push(backendRequest(`/api/sheets/${year}/${month}`, {
        method: "PUT",
        body: JSON.stringify({ url }),
      }));
    }
  });
  state.settings.currentYear = year;
  els.dashboardYear.value = String(year);
  if (saves.length) await Promise.all(saves);
  addLog(`Saved Google Sheet links for ${year}`);
  saveSettings();
  renderAll();
}

async function testMonth(year, month) {
  await saveSheetInputs();
  const item = ensureYear(year)[month];
  if (!item.url) return updateMonthStatus(year, month, { status: "No link" });
  updateMonthStatus(year, month, { status: "Testing connection..." });
  try {
    const text = await fetchSheetCsv(item.url);
    const rows = parseCsv(text);
    updateMonthStatus(year, month, {
      status: "Connected",
      sheetName: extractSheetName(item.url) || `${year} ${MONTHS[month - 1]}`,
      imported: item.imported || 0,
    });
    addLog(`Connection tested for ${MONTHS[month - 1]} ${year}: ${rows.length} readable rows`);
  } catch (error) {
    updateMonthStatus(year, month, { status: `Connection failed: ${error.message}` });
  }
}

async function syncYear(year) {
  await saveSheetInputs();
  if (API_BASE) {
    try {
      updateAllMonthStatuses(year, "Syncing via backend...");
      await backendRequest(`/api/sync/${year}`, { method: "POST" });
      addLog(`Backend synced year ${year}`);
      await refreshAll();
      return;
    } catch (error) {
      alert(error.message);
      renderAll();
      return;
    }
  }
  const sheets = ensureYear(year);
  const months = Object.keys(sheets).filter((month) => sheets[month].url);
  if (!months.length) {
    alert("No Google Sheet links saved for this year.");
    return;
  }
  for (const month of months) {
    await syncMonth(year, Number(month), true);
  }
  await refreshAll();
}

async function syncMonth(year, month, quiet = false) {
  await saveSheetInputs();
  const item = ensureYear(year)[month];
  if (!item.url) {
    if (!quiet) alert("Paste a Google Sheet URL first.");
    return;
  }
  updateMonthStatus(year, month, { status: "Syncing..." });
  if (API_BASE) {
    try {
      const result = await backendRequest(`/api/sync/${year}/${month}`, { method: "POST" });
      updateMonthStatus(year, month, {
        status: "Synced",
        lastSync: new Date().toISOString(),
        imported: result.importedRecords || 0,
      });
      addLog(`Backend synced ${MONTHS[month - 1]} ${year}`);
      return;
    } catch (error) {
      updateMonthStatus(year, month, { status: `Sync failed: ${error.message}` });
      return;
    }
  }
  try {
    const text = await fetchSheetCsv(item.url);
    const rows = parseCsv(text);
    const sheetKey = `${year}-${String(month).padStart(2, "0")}`;
    const records = rows.map((row, index) => normalizeRecord(row, { year, month, sheetKey, sourceUrl: item.url, rowNumber: index + 2 })).filter(Boolean);
    await replaceSheetRecords(sheetKey, records);
    updateMonthStatus(year, month, {
      status: "Synced",
      sheetName: extractSheetName(item.url) || `${MONTHS[month - 1]} Sheet`,
      lastSync: new Date().toISOString(),
      imported: records.length,
    });
    addLog(`Synced ${numberFormat(records.length)} records for ${MONTHS[month - 1]} ${year}`);
    if (!quiet) await refreshAll();
  } catch (error) {
    updateMonthStatus(year, month, { status: `Sync failed: ${error.message}` });
  }
}

async function removeMonth(year, month) {
  if (!confirm(`Remove ${MONTHS[month - 1]} link and synchronized records?`)) return;
  const sheetKey = `${year}-${String(month).padStart(2, "0")}`;
  await replaceSheetRecords(sheetKey, []);
  state.settings.sheets[year][month] = {
    month: MONTHS[month - 1],
    url: "",
    status: "No link",
    sheetName: "",
    lastSync: "",
    imported: 0,
  };
  addLog(`Removed ${MONTHS[month - 1]} ${year}`);
  saveSettings();
  await refreshAll();
}

function updateMonthStatus(year, month, patch) {
  Object.assign(ensureYear(year)[month], patch);
  saveSettings();
  renderSheetManager(year);
  renderSyncList();
  renderSettings();
}

function updateAllMonthStatuses(year, status) {
  const sheets = ensureYear(year);
  Object.keys(sheets).forEach((month) => {
    if (sheets[month].url) sheets[month].status = status;
  });
  saveSettings();
  renderSheetManager(year);
  renderSyncList();
}

async function fetchSheetCsv(url) {
  let directProblem = "";
  const csvUrl = toCsvUrl(url);
  try {
    const response = await fetch(csvUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text.trim() || text.trim().startsWith("<!doctype")) throw new Error("Sheet is not readable from browser preview");
    return text;
  } catch (error) {
    directProblem = error.message || "Direct Google Sheet read failed";
    try {
      return await fetchSheetJsonpCsv(url);
    } catch (jsonpError) {
      directProblem = jsonpError.message || directProblem;
      if (location.protocol === "file:") {
        throw new Error("Local file preview cannot read this Sheet. Deploy the zip to Netlify and add GOOGLE_SHEETS_API_KEY.");
      }
    }
  }

  if (location.protocol !== "file:") {
    try {
      const proxy = `/.netlify/functions/sheet-proxy?url=${encodeURIComponent(url)}`;
      const proxyResponse = await fetch(proxy, { cache: "no-store" });
      const proxyText = await proxyResponse.text();
      if (proxyResponse.ok && proxyText.trim() && !proxyText.trim().startsWith("<!doctype")) return proxyText;
      if (proxyResponse.status === 404 || proxyText.trim() === "Not Found") {
        throw new Error("Netlify Function not found. If direct read works on localhost, redeploy this updated zip or use Git/CLI deploy for functions.");
      }
      try {
        const payload = JSON.parse(proxyText);
        throw new Error(payload.error || "Netlify proxy failed");
      } catch (parseError) {
        throw new Error(parseError.message || proxyText || "Netlify proxy failed");
      }
    } catch (proxyError) {
      throw new Error(`${directProblem}. ${proxyError.message || "Netlify proxy failed"}`);
    }
  }

  throw new Error(directProblem || "Google Sheet read failed");
}

function toCsvUrl(url) {
  const clean = String(url || "").trim();
  if (!clean) throw new Error("Missing URL");
  if (clean.includes("output=csv") || clean.endsWith(".csv")) return clean;
  if (clean.includes("/spreadsheets/d/e/") && clean.includes("/pubhtml")) {
    return clean.replace("/pubhtml", "/pub").replace(/([?&])output=html\b/, "$1output=csv");
  }
  if (clean.includes("/spreadsheets/d/e/") && clean.includes("/pub?")) {
    return clean.includes("output=") ? clean.replace(/output=[^&]+/, "output=csv") : `${clean}&output=csv`;
  }
  const id = clean.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  if (!id) throw new Error("Invalid Google Sheet URL");
  const gid = clean.match(/[?&#]gid=([0-9]+)/)?.[1] || "0";
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

function sheetParts(url) {
  const clean = String(url || "").trim();
  const id = clean.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  if (!id) throw new Error("Invalid Google Sheet URL");
  const gid = clean.match(/[?&#]gid=([0-9]+)/)?.[1] || "0";
  return { id, gid };
}

function fetchSheetJsonpCsv(url) {
  const { id, gid } = sheetParts(url);
  const callback = `sheetCallback_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const src = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?gid=${gid}&tqx=out:json;responseHandler:${callback}`;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const cleanup = () => {
      delete window[callback];
      script.remove();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Sheet must be readable by Google Sheets API"));
    }, 15000);
    window[callback] = (payload) => {
      clearTimeout(timer);
      cleanup();
      if (payload?.status === "error") {
        reject(new Error(payload.errors?.[0]?.detailed_message || "Google Sheet connection failed"));
        return;
      }
      resolve(gvizToCsv(payload));
    };
    script.onerror = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error("Google Sheet connection blocked"));
    };
    script.src = src;
    document.head.appendChild(script);
  });
}

function gvizToCsv(payload) {
  const table = payload?.table;
  if (!table?.cols?.length) throw new Error("No readable columns found");
  const headers = table.cols.map((col, index) => col.label || col.id || `Column ${index + 1}`);
  const rows = (table.rows || []).map((row) => headers.map((_, index) => {
    const cell = row.c?.[index];
    if (!cell) return "";
    return cell.f ?? cell.v ?? "";
  }));
  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

function extractSheetName(url) {
  const id = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  return id ? `Google Sheet ${id.slice(0, 6)}` : "";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  const cleanRows = rows.filter((entry) => entry.some((value) => String(value).trim()));
  const headerIndex = findHeaderRowIndex(cleanRows);
  const headers = cleanRows[headerIndex] || [];
  return cleanRows.slice(headerIndex + 1).map((entry) => Object.fromEntries(headers.map((header, index) => [String(header).trim(), entry[index] || ""])));
}

function findHeaderRowIndex(rows) {
  const expected = [
    "creatorcode",
    "waybillnumber",
    "orderstatus",
    "signingtime",
    "receiver",
    "receivercellphone",
    "submissiontime",
    "remarks",
    "sendername",
  ];
  let best = { index: 0, score: 0 };
  rows.slice(0, 20).forEach((row, index) => {
    const keys = row.map((cell) => headerKey(cell));
    const score = expected.filter((header) => keys.includes(header)).length;
    if (score > best.score) best = { index, score };
  });
  return best.score >= 2 ? best.index : 0;
}

function normalizeRecord(row, meta) {
  const creatorCode = pick(row, ["creator code"]);
  const tracking = pick(row, [
    "waybill number",
    "waybill numb",
    "waybill no",
    "waybill",
    "tracking number",
    "tracking",
    "tracking no",
    "awb",
    "order id",
    "order number",
  ]);
  const customer = pick(row, [
    "receiver",
    "receiver name",
    "customer name",
    "name",
    "customer",
    "buyer",
    "recipient",
    "consignee",
  ]);
  const mobile = pick(row, [
    "receiver ce",
    "receiver cell",
    "receiver cellphone",
    "receiver cellphone number",
    "receiver contact",
    "receiver contact number",
    "receiver mobile",
    "receiver phone",
    "mobile number",
    "mobile no",
    "mobile",
    "phone number",
    "phone no",
    "phone",
    "contact number",
    "contact no",
    "contact",
    "cellphone",
    "cellphone number",
    "cell phone",
    "cp number",
    "cp no",
    "cp",
    "customer mobile",
    "customer phone",
    "customer contact",
    "recipient mobile",
    "recipient phone",
    "number",
  ]) || findPhoneLike(row);
  const product = pick(row, ["remarks", "product", "item", "sku", "description", "product name", "order item"]);
  const amount = money(pick(row, ["price", "amount", "total", "cod", "subtotal", "order total"]));
  const signingTime = pick(row, ["signingtime", "signing time"]);
  const submissionTime = pick(row, ["submission time", "submission tir"]);
  const date = parseDate(signingTime || submissionTime || pick(row, ["order date", "date", "created date", "date order", "created at"]), meta.year, meta.month);
  const statusRaw = pick(row, ["order status", "status", "delivery status", "shipment status"]);
  const courier = pick(row, ["sender name", "courier", "shipping", "logistics", "provider", "carrier"]);
  if (!tracking && !customer && !mobile && !product && !statusRaw) return null;
  const status = normalizeStatus(statusRaw);
  const rawValues = Object.values(row).join(" ");
  const search = normalize([tracking, customer, mobile, product, courier, statusRaw, rawValues].join(" "));
  return {
    id: `${meta.sheetKey}-${meta.rowNumber}-${hashMini(search)}`,
    sheetKey: meta.sheetKey,
    year: meta.year,
    month: meta.month,
    orderDate: date,
    tracking,
    customer,
    mobile,
    digits: mobile.replace(/\D/g, ""),
    product,
    amount,
    status,
    statusLabel: STATUS[status],
    courier,
    creatorCode,
    waybillNumber: tracking,
    orderStatus: statusRaw,
    signingTime,
    receiver: customer,
    receiverCellphone: mobile,
    submissionTime,
    remarks: product,
    senderName: courier,
    search,
    rawSearch: normalize(rawValues),
    rawDigits: digitsOnly(rawValues),
    syncedAt: new Date().toISOString(),
  };
}

function pick(row, names) {
  const keys = Object.keys(row);
  for (const name of names) {
    const exact = keys.find((key) => headerKey(key) === headerKey(name));
    if (exact && String(row[exact]).trim()) return String(row[exact]).trim();
  }
  const loose = keys.find((key) => names.some((name) => headerKey(key).includes(headerKey(name))));
  return loose ? String(row[loose] || "").trim() : "";
}

function findPhoneLike(row) {
  const entries = Object.entries(row)
    .map(([key, value]) => [String(key || ""), String(value || "").trim()])
    .filter(([, value]) => value);
  const phoneHeader = entries.find(([key, value]) => isPhoneHeader(key) && isPhoneValue(value));
  if (phoneHeader) return phoneHeader[1];
  const found = entries.find(([key, value]) => !isTrackingHeader(key) && isPhoneValue(value));
  return found?.[1] || "";
}

function isPhoneHeader(value) {
  const key = headerKey(value);
  return ["cp", "contact", "mobile", "phone", "cell", "tel"].some((token) => key.includes(token));
}

function isTrackingHeader(value) {
  const key = headerKey(value);
  return ["tracking", "waybill", "awb", "orderid", "ordernumber"].some((token) => key.includes(token));
}

function isPhoneValue(value) {
  const raw = String(value || "").trim();
  if (/[a-zA-Z]/.test(raw)) return false;
  const digits = digitsOnly(raw);
  if (digits.length < 10 || digits.length > 13) return false;
  return (
    digits.startsWith("09") ||
    digits.startsWith("639") ||
    (digits.length === 10 && digits.startsWith("9"))
  );
}

function headerKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeStatus(value) {
  const raw = normalize(value);
  if (raw.includes("delivered")) return "delivered";
  if (raw.includes("out for delivery") || raw === "ofd") return "ofd";
  if (raw.includes("for return")) return "for-return";
  if (raw.includes("return") || raw.includes("rts")) return "return";
  if (raw.includes("transit") || raw.includes("ship")) return "transit";
  if (raw.includes("pending") || raw.includes("process")) return "pending";
  return "other";
}

function parseDate(value, year, month) {
  const raw = String(value || "").trim();
  const fallback = `${year}-${String(month).padStart(2, "0")}-01`;
  if (!raw) return fallback;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const dateTime = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\s+\d{1,2}:\d{2}/);
  if (dateTime) {
    const parsedYear = dateTime[3].length === 2 ? `20${dateTime[3]}` : dateTime[3];
    return `${parsedYear}-${String(dateTime[1]).padStart(2, "0")}-${String(dateTime[2]).padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return fallback;
}

function money(value) {
  const number = Number(String(value || "0").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function hashMini(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(16);
}

function filteredDashboardRecords() {
  const year = Number(els.dashboardYear.value || state.settings.currentYear);
  const month = Number(els.dashboardMonth.value || 0);
  const status = els.dashboardStatus.value;
  return state.records.filter((record) => {
    if (record.year !== year) return false;
    if (month && record.month !== month) return false;
    if (status && record.status !== status) return false;
    return true;
  });
}

function renderDashboard() {
  const records = filteredDashboardRecords();
  state.dashboardRecords = records;
  const summary = summarize(records);
  els.metrics.innerHTML = [
    ["Total Records", numberFormat(summary.total)],
    ["Delivered", numberFormat(summary.counts.delivered || 0)],
    ["Returns", numberFormat((summary.counts.return || 0) + (summary.counts["for-return"] || 0))],
    ["Delivery Rate", percent(summary.counts.delivered || 0, summary.total)],
    ["Total Amount", peso(summary.amount)],
    ["Last Sync", latestSyncLabel()],
  ].map(metricCard).join("");
  els.statusChartLabel.textContent = `${numberFormat(summary.total)} records`;
  els.trendLabel.textContent = `${els.dashboardYear.value}`;
  drawStatusChart(els.statusChart, summary.counts);
  drawTrendChart(els.trendChart, state.records.filter((record) => record.year === Number(els.dashboardYear.value)));
  els.recentBody.innerHTML = records.slice().sort((a, b) => b.orderDate.localeCompare(a.orderDate)).slice(0, 80).map(rowHtml).join("") || emptyRow(8, "No synchronized records yet.");
}

function summarize(records) {
  const counts = Object.fromEntries(Object.keys(STATUS).map((key) => [key, 0]));
  let amount = 0;
  records.forEach((record) => {
    counts[record.status] = (counts[record.status] || 0) + 1;
    amount += Number(record.amount) || 0;
  });
  return { total: records.length, counts, amount };
}

function latestSyncLabel() {
  const all = Object.values(state.settings.sheets).flatMap((year) => Object.values(year));
  const latest = all.map((item) => item.lastSync).filter(Boolean).sort().pop();
  return latest ? new Date(latest).toLocaleString() : "Never";
}

function drawStatusChart(canvas, counts) {
  const { ctx, width, height } = setupCanvas(canvas);
  const entries = Object.entries(counts).filter(([, value]) => value > 0);
  if (!entries.length) return drawEmpty(ctx, width, height);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  let start = -Math.PI / 2;
  const radius = Math.min(width, height) * 0.32;
  const cx = width * 0.32;
  const cy = height * 0.5;
  entries.forEach(([key, value]) => {
    const slice = (value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, start + slice);
    ctx.closePath();
    ctx.fillStyle = COLORS[key];
    ctx.fill();
    start += slice;
  });
  entries.forEach(([key, value], index) => {
    const y = 44 + index * 29;
    ctx.fillStyle = COLORS[key];
    ctx.fillRect(width * 0.63, y - 11, 14, 14);
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--text");
    ctx.font = "13px Segoe UI";
    ctx.fillText(`${STATUS[key]}: ${numberFormat(value)}`, width * 0.63 + 22, y);
  });
}

function drawTrendChart(canvas, records) {
  const { ctx, width, height } = setupCanvas(canvas);
  const counts = Array.from({ length: 12 }, () => 0);
  records.forEach((record) => counts[record.month - 1] += 1);
  if (!records.length) return drawEmpty(ctx, width, height);
  const max = Math.max(1, ...counts);
  const left = 38;
  const bottom = height - 40;
  const step = (width - left - 20) / 11;
  ctx.strokeStyle = "rgba(140,150,145,.35)";
  ctx.beginPath();
  ctx.moveTo(left, 18);
  ctx.lineTo(left, bottom);
  ctx.lineTo(width - 12, bottom);
  ctx.stroke();
  ctx.strokeStyle = COLORS.delivered;
  ctx.lineWidth = 3;
  ctx.beginPath();
  counts.forEach((value, index) => {
    const x = left + index * step;
    const y = bottom - (value / max) * (height - 78);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  counts.forEach((value, index) => {
    const x = left + index * step;
    const y = bottom - (value / max) * (height - 78);
    ctx.fillStyle = COLORS.delivered;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--muted");
    ctx.font = "11px Segoe UI";
    ctx.fillText(MONTHS[index].slice(0, 3), x - 10, height - 14);
  });
}

function setupCanvas(canvas) {
  const scale = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * scale;
  canvas.height = rect.height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, rect.width, rect.height);
  return { ctx, width: rect.width, height: rect.height };
}

function drawEmpty(ctx, width, height) {
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--muted");
  ctx.font = "14px Segoe UI";
  ctx.fillText("No data yet", width / 2 - 34, height / 2);
}

function renderSyncList() {
  const year = Number(els.sheetYear.value || state.settings.currentYear);
  const sheets = ensureYear(year);
  const linked = Object.values(sheets).filter((item) => item.url).length;
  const imported = Object.values(sheets).reduce((sum, item) => sum + (Number(item.imported) || 0), 0);
  els.syncSummary.textContent = `${linked} linked sheets | ${numberFormat(imported)} imported records`;
  els.syncList.innerHTML = MONTHS.map((month, index) => {
    const item = sheets[index + 1];
    const dot = item.url ? (item.imported ? "ok" : "warn") : "bad";
    return `
      <article class="sync-item">
        <div>
          <strong>${month}</strong>
          <span>${escapeHtml(item.status)} | ${item.lastSync ? new Date(item.lastSync).toLocaleString() : "Never synced"}</span>
        </div>
        <div>
          <span>${numberFormat(item.imported || 0)} records</span>
          <i class="status-dot ${dot}"></i>
        </div>
      </article>
    `;
  }).join("");
}

async function renderSearch() {
  const terms = searchTerms(els.searchInput.value);
  if (!terms.length) {
    els.customerMetrics.innerHTML = [
      ["Orders", "0"],
      ["Total Amount", peso(0)],
      ["Delivered", "0"],
      ["Delivery Rate", "0%"],
      ["RTS Count", "0"],
      ["RTS Rate", "0%"],
    ].map(metricCard).join("");
    renderRtsWarning(0, 0, 0);
    els.searchCount.textContent = "0 records";
    els.searchBody.innerHTML = emptyRow(9, `Type at least 2 characters to search ${numberFormat(state.records.length)} synced rows. You can paste many CP numbers or waybills at once.`);
    return;
  }
  if (API_BASE) {
    await renderBackendSearch(terms);
    return;
  }
  const records = state.records.filter((record) => {
    return terms.some((term) => {
      const textMatch = record._searchText.includes(term.text);
      const digitMatch = term.digits.length >= 2 && record._searchDigits.includes(term.digits);
      return textMatch || digitMatch;
    });
  }).slice(0, 5000);
  const summary = summarize(records);
  const rtsCount = (summary.counts.return || 0) + (summary.counts["for-return"] || 0);
  const rtsRate = summary.total ? Math.round((rtsCount / summary.total) * 100) : 0;
  els.customerMetrics.innerHTML = [
    ["Orders", numberFormat(summary.total)],
    ["Total Amount", peso(summary.amount)],
    ["Delivered", numberFormat(summary.counts.delivered || 0)],
    ["Delivery Rate", percent(summary.counts.delivered || 0, summary.total)],
    ["RTS Count", numberFormat(rtsCount)],
    ["RTS Rate", `${rtsRate}%`],
  ].map(metricCard).join("");
  renderRtsWarning(summary.total, rtsCount, rtsRate);
  els.searchCount.textContent = `${numberFormat(records.length)} records`;
  const emptyMessage = state.records.length
    ? `No matching records in ${numberFormat(state.records.length)} synced rows. Try re-syncing so CP number columns are indexed.`
    : hasSavedSheetLinks(Number(els.sheetYear.value || state.settings.currentYear))
      ? "No synchronized records yet. The app is trying to sync saved Google Sheet links. If this stays empty, open Annual Google Sheets and check the month status."
      : "No synchronized records yet. Add a Google Sheet link, then click Sync.";
  els.searchBody.innerHTML = records.slice(0, 500).map(rowHtml).join("") || emptyRow(9, emptyMessage);
}

async function renderBackendSearch(terms) {
  try {
    const payload = await backendRequest(`/api/search?q=${encodeURIComponent(terms.map((term) => term.text || term.digits).join(" "))}`);
    const summary = payload.summary || {};
    const rows = payload.rows || [];
    els.customerMetrics.innerHTML = [
      ["Orders", numberFormat(summary.total || 0)],
      ["Total Amount", peso(summary.amount || 0)],
      ["Delivered", numberFormat(summary.delivered || 0)],
      ["Delivery Rate", `${summary.deliveryRate || 0}%`],
      ["RTS Count", numberFormat(summary.rts || 0)],
      ["RTS Rate", `${summary.rtsRate || 0}%`],
    ].map(metricCard).join("");
    renderRtsWarning(Number(summary.total) || 0, Number(summary.rts) || 0, Number(summary.rtsRate) || 0);
    els.searchCount.textContent = `${numberFormat(rows.length)} records`;
    els.searchBody.innerHTML = rows.length ? rows.map(rowHtml).join("") : emptyRow(9, "No matching backend records.");
  } catch (error) {
    els.searchBody.innerHTML = emptyRow(9, error.message);
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
    const text = normalize(term);
    const digits = digitsOnly(term);
    if (text.length >= 2 || digits.length >= 2) unique.set(text || digits, { text, digits });
  });
  return [...unique.values()];
}

function prepareRecord(record) {
  record._searchText = recordSearchText(record);
  record._searchDigits = recordSearchDigits(record);
  record._brandName = brandName(record.remarks || record.product || "Unknown Product");
  return record;
}

function renderRtsWarning(total, rtsCount, rtsRate) {
  if (!els.rtsWarning) return;
  if (total < 3 || rtsRate < 20) {
    els.rtsWarning.classList.add("hidden");
    els.rtsWarning.innerHTML = "";
    return;
  }
  const level = rtsRate >= 40 ? "High RTS warning" : "RTS watchlist";
  els.rtsWarning.classList.remove("hidden");
  els.rtsWarning.innerHTML = `<strong>${level}:</strong> ${numberFormat(rtsCount)} of ${numberFormat(total)} orders are RTS/return (${rtsRate}%). Review this customer before sending new deliveries.`;
}

function recordSearchText(record) {
  return normalize([
    record.search,
    record.rawSearch,
    record.customer,
    record.customerName,
    record.name,
    record.mobile,
    record.phone,
    record.tracking,
    record.trackingNumber,
    record.product,
    record.courier,
    record.statusLabel,
    record.statusText,
  ].join(" "));
}

function recordSearchDigits(record) {
  return digitsOnly([
    record.rawDigits,
    record.digits,
    record.mobile,
    record.phone,
    record.receiverCellphone,
    record.tracking,
    record.trackingNumber,
    record.waybillNumber,
  ].join(" "));
}

function renderProducts() {
  if (!state.productsDirty) return;
  const map = new Map();
  state.records.forEach((record) => {
    const key = record._brandName || brandName(record.remarks || record.product || "Unknown Product");
    if (!map.has(key)) map.set(key, { product: key, orders: 0, delivered: 0, returned: 0, amount: 0 });
    const item = map.get(key);
    item.orders += 1;
    item.amount += Number(record.amount) || 0;
    if (record.status === "delivered") item.delivered += 1;
    if (record.status === "return" || record.status === "for-return") item.returned += 1;
  });
  const products = [...map.values()].sort((a, b) => b.orders - a.orders).slice(0, 200);
  els.productCount.textContent = `${numberFormat(products.length)} products`;
  els.productBody.innerHTML = products.map((item) => `
    <tr>
      <td>${escapeHtml(item.product)}</td>
      <td>${numberFormat(item.orders)}</td>
      <td>${numberFormat(item.delivered)}</td>
      <td>${numberFormat(item.returned)}</td>
      <td>${peso(item.amount)}</td>
    </tr>
  `).join("") || emptyRow(5, "No product records yet.");
  state.productsDirty = false;
}

function brandName(value) {
  let name = String(value || "Unknown Product").toUpperCase();
  name = name
    .replace(/\b\d+\s*(SET|SETS|PACK|PACKS|PCS|PC|PIECES|PIECE|BOTTLE|BOTTLES|BOX|BOXES)\b/g, " ")
    .replace(/\bB\d+\s*T\d+\b/g, " ")
    .replace(/\bB\d+T\d+\b/g, " ")
    .replace(/\b\d+\s*IN\s*1\b/g, " ")
    .replace(/\b\d+\s*X\b/g, " ")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+\d+\s*$/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return name || "UNKNOWN PRODUCT";
}

function renderSettings() {
  const years = new Set(state.records.map((record) => record.year));
  const linked = Object.values(state.settings.sheets).flatMap((year) => Object.values(year)).filter((item) => item.url).length;
  els.settingsGrid.innerHTML = [
    ["Internal Records", numberFormat(state.records.length)],
    ["Years", numberFormat(years.size)],
    ["Linked Sheets", numberFormat(linked)],
    ["Storage", "IndexedDB"],
    ["Last Sync", latestSyncLabel()],
    ["Theme", state.settings.theme === "light" ? "Light" : "Dark"],
    ["Designed Limit", "1M+ records"],
    ["Source of Truth", "Google Sheets"],
  ].map(([label, value]) => `<article class="settings-card"><span>${label}</span><strong>${value}</strong></article>`).join("");
  els.logs.innerHTML = state.settings.logs.length
    ? state.settings.logs.map((log) => `<article class="log-item"><strong>${escapeHtml(log.message)}</strong><span>${new Date(log.at).toLocaleString()}</span></article>`).join("")
    : `<div class="empty">No activity logs yet.</div>`;
  renderAgentAdminTables();
}

async function renderAgentAdminTables() {
  if (!els.agentAccountsBody || !els.agentLoginsBody) return;
  if (!API_BASE) {
    els.agentAccountCount.textContent = "Backend not connected";
    els.agentLoginCount.textContent = "Backend not connected";
    els.agentAccountsBody.innerHTML = emptyRow(7, "Connect the Render backend to view registered agents.");
    els.agentLoginsBody.innerHTML = emptyRow(4, "Connect the Render backend to view login activity.");
    return;
  }
  if (!state.adminToken) {
    els.agentAccountCount.textContent = "Admin login required";
    els.agentLoginCount.textContent = "Admin login required";
    els.agentAccountsBody.innerHTML = emptyRow(7, "Login as admin to view agent accounts.");
    els.agentLoginsBody.innerHTML = emptyRow(4, "Login as admin to view agent login activity.");
    return;
  }
  try {
    const [agentsPayload, loginsPayload] = await Promise.all([
      backendRequest("/api/agents"),
      backendRequest("/api/login-activity"),
    ]);
    const agents = agentsPayload.agents || [];
    const events = loginsPayload.events || [];
    els.agentAccountCount.textContent = `${numberFormat(agents.length)} accounts`;
    els.agentLoginCount.textContent = `${numberFormat(events.length)} latest logins`;
    els.agentAccountsBody.innerHTML = agents.length ? agents.map(agentAccountRow).join("") : emptyRow(7, "No agent accounts yet.");
    els.agentLoginsBody.innerHTML = events.length ? events.map(agentLoginRow).join("") : emptyRow(4, "No login activity yet.");
  } catch (error) {
    els.agentAccountCount.textContent = "Unable to load";
    els.agentLoginCount.textContent = "Unable to load";
    els.agentAccountsBody.innerHTML = emptyRow(7, escapeHtml(error.message || "Unable to load agent accounts."));
    els.agentLoginsBody.innerHTML = emptyRow(4, escapeHtml(error.message || "Unable to load login activity."));
  }
}

function agentAccountRow(agent) {
  const isAgent = agent.role === "agent";
  const action = !isAgent
    ? "-"
    : agent.active
      ? `<button class="secondary danger" data-agent-action="disable" data-agent-id="${agent.id}" type="button">Disable</button>`
      : `<button data-agent-action="approve" data-agent-id="${agent.id}" type="button">Approve</button>`;
  return `
    <tr>
      <td>${escapeHtml(agent.username)}</td>
      <td>${escapeHtml(agent.role)}</td>
      <td>${agent.active ? "Approved" : "Pending"}</td>
      <td>${numberFormat(agent.login_count)}</td>
      <td>${dateTimeLabel(agent.last_login)}</td>
      <td>${dateTimeLabel(agent.created_at)}</td>
      <td>${action}</td>
    </tr>
  `;
}

async function updateAgentApproval(id, active) {
  if (!id) return;
  try {
    await backendRequest(`/api/agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ active }),
    });
    addLog(active ? "Approved agent account" : "Disabled agent account");
    await renderAgentAdminTables();
  } catch (error) {
    alert(error.message || "Unable to update agent account.");
  }
}

function agentLoginRow(event) {
  return `
    <tr>
      <td>${escapeHtml(event.username)}</td>
      <td>${escapeHtml(event.role)}</td>
      <td>${dateTimeLabel(event.logged_in_at)}</td>
      <td>${escapeHtml(event.ip_address || "-")}</td>
    </tr>
  `;
}

function dateTimeLabel(value) {
  return value ? new Date(value).toLocaleString() : "-";
}

function rowHtml(record) {
  const status = record.status || record.normalized_status || "other";
  const orderStatus = record.orderStatus || record.order_status || record.statusText || record.statusLabel || STATUS[status] || "-";
  return `
    <tr>
      <td>${escapeHtml(record.creatorCode || record.creator_code || "-")}</td>
      <td>${escapeHtml(record.waybillNumber || record.waybill_number || record.tracking || record.trackingNumber || "-")}</td>
      <td><span class="badge ${status}">${escapeHtml(orderStatus)}</span></td>
      <td>${escapeHtml(record.signingTime || record.signing_time || record.orderDate || record.order_date || "-")}</td>
      <td>${escapeHtml(record.receiver || record.customer || record.customerName || "-")}</td>
      <td>${escapeHtml(record.receiverCellphone || record.receiver_cellphone || record.mobile || record.phone || "-")}</td>
      <td>${escapeHtml(record.submissionTime || record.submission_time || "-")}</td>
      <td>${escapeHtml(record.remarks || record.product || "-")}</td>
      <td>${escapeHtml(record.senderName || record.sender_name || record.courier || "-")}</td>
    </tr>
  `;
}

function metricCard([label, value]) {
  return `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`;
}

function emptyRow(colspan, message) {
  return `<tr><td colspan="${colspan}">${message}</td></tr>`;
}

function exportCsv() {
  const records = state.dashboardRecords.length ? state.dashboardRecords : state.records;
  const headers = ["Creator Code", "Waybill Number", "Order Status", "SigningTime", "Receiver", "Receiver Cellphone", "Submission Time", "Remarks", "Sender Name"];
  const rows = records.map((record) => [
    record.creatorCode,
    record.waybillNumber || record.tracking,
    record.orderStatus || record.statusLabel,
    record.signingTime || record.orderDate,
    record.receiver || record.customer,
    record.receiverCellphone || record.mobile,
    record.submissionTime,
    record.remarks || record.product,
    record.senderName || record.courier,
  ]);
  download(`delivery-report-${dateStamp()}.csv`, [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n"), "text/csv");
  addLog("Exported CSV report");
  saveSettings();
  renderSettings();
}

function backupSettings() {
  download(`delivery-system-settings-${dateStamp()}.json`, JSON.stringify({
    exportedAt: new Date().toISOString(),
    settings: state.settings,
  }, null, 2), "application/json");
}

async function restoreSettings() {
  const file = els.restoreInput.files[0];
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    state.settings = { ...defaultSettings(), ...(backup.settings || backup) };
    saveSettings();
    addLog("Restored system settings");
    renderAll();
  } catch {
    alert("Invalid backup file.");
  } finally {
    els.restoreInput.value = "";
  }
}

function addLog(message) {
  state.settings.logs = [{ at: new Date().toISOString(), message }, ...(state.settings.logs || [])].slice(0, 120);
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function numberFormat(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function peso(value) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function percent(value, total) {
  return total ? `${Math.round((value / total) * 100)}%` : "0%";
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function debounce(fn, wait) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), wait);
  };
}

window.addEventListener("resize", debounce(renderDashboard, 150));
