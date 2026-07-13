export async function readGoogleSheetRows(sheetUrl) {
  const { id, gid } = sheetParts(sheetUrl);
  const apiKey = validApiKey(process.env.GOOGLE_SHEETS_API_KEY);

  if (apiKey) {
    return readViaSheetsApi(id, gid, apiKey);
  }

  const csvUrl = toCsvUrl(sheetUrl);
  const response = await fetch(csvUrl, {
    headers: { "User-Agent": "BackTrackingDeliveryReporting/1.0" },
  });

  if (!response.ok) throw new Error(`Google Sheet returned HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trim() || text.trim().startsWith("<!doctype")) {
    throw new Error("Sheet is not readable. Make the Sheet public viewer or publish it as CSV.");
  }

  return parseCsv(text);
}

async function readViaSheetsApi(id, gid, key) {
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties&key=${key}`;
  const metaResponse = await fetch(metaUrl);
  if (!metaResponse.ok) throw new Error(`Google Sheets metadata failed: HTTP ${metaResponse.status}`);
  const meta = await metaResponse.json();
  const sheet = (meta.sheets || []).find((entry) => String(entry.properties?.sheetId) === String(gid)) || meta.sheets?.[0];
  const title = sheet?.properties?.title;
  if (!title) throw new Error("No readable sheet tab found.");

  const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'`);
  const valuesUrl = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&key=${key}`;
  const valuesResponse = await fetch(valuesUrl);
  if (!valuesResponse.ok) throw new Error(`Google Sheets values failed: HTTP ${valuesResponse.status}`);
  const values = await valuesResponse.json();
  return rowsToObjects(values.values || []);
}

function toCsvUrl(url) {
  const clean = String(url || "").trim();
  if (!clean) throw new Error("Missing Google Sheet URL");
  if (clean.includes("output=csv") || clean.endsWith(".csv")) return clean;
  const { id, gid } = sheetParts(clean);
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

function sheetParts(url) {
  const clean = String(url || "").trim();
  const id = clean.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  if (!id) throw new Error("Invalid Google Sheet URL");
  const gid = clean.match(/[?&#]gid=([0-9]+)/)?.[1] || "0";
  return { id, gid };
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
  return rowsToObjects(rows);
}

function rowsToObjects(rows) {
  const cleanRows = rows.filter((entry) => entry.some((value) => String(value || "").trim()));
  const headerIndex = findHeaderRowIndex(cleanRows);
  const headers = cleanRows[headerIndex] || [];
  return cleanRows.slice(headerIndex + 1).map((entry) => {
    return Object.fromEntries(headers.map((header, index) => [String(header || "").trim(), entry[index] || ""]));
  });
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

function headerKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function validApiKey(value) {
  const key = String(value || "").trim();
  if (!key) return "";
  if (["not-set-yet", "none", "null", "undefined", "no-api"].includes(key.toLowerCase())) return "";
  return key;
}
