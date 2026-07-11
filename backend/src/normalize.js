export function normalizeRecord(row, meta) {
  const creatorCode = pick(row, ["creator code"]);
  const waybillNumber = pick(row, ["waybill number", "waybill no", "waybill"]);
  const orderStatus = pick(row, ["order status", "status"]);
  const signingTime = pick(row, ["signingtime", "signing time"]);
  const receiver = pick(row, ["receiver", "receiver name"]);
  const receiverCellphone = pick(row, ["receiver cellphone", "receiver cell", "receiver ce", "receiver contact", "cp number", "mobile number"]);
  const submissionTime = pick(row, ["submission time"]);
  const remarks = pick(row, ["remarks", "product", "item"]);
  const senderName = pick(row, ["sender name", "courier"]);

  if (!waybillNumber && !receiver && !receiverCellphone && !remarks && !orderStatus) return null;

  const normalizedStatus = normalizeStatus(orderStatus);
  const orderDate = parseDate(signingTime || submissionTime, meta.year, meta.month);
  const rawValues = Object.values(row).join(" ");
  const searchText = normalizeText([
    creatorCode,
    waybillNumber,
    orderStatus,
    signingTime,
    receiver,
    receiverCellphone,
    submissionTime,
    remarks,
    senderName,
    rawValues,
  ].join(" "));
  const searchDigits = digitsOnly([waybillNumber, receiverCellphone, rawValues].join(" "));

  return {
    id: `${meta.sheetKey}-${meta.rowNumber}-${hashMini(searchText)}`,
    year: meta.year,
    month: meta.month,
    sheetKey: meta.sheetKey,
    rowNumber: meta.rowNumber,
    creatorCode,
    waybillNumber,
    orderStatus,
    signingTime,
    receiver,
    receiverCellphone,
    submissionTime,
    remarks,
    senderName,
    normalizedStatus,
    orderDate,
    amount: 0,
    searchText,
    searchDigits,
    raw: row,
  };
}

export function normalizeStatus(value) {
  const raw = normalizeText(value);
  if (raw.includes("delivered")) return "delivered";
  if (raw.includes("out for delivery") || raw === "ofd") return "ofd";
  if (raw.includes("for return")) return "for-return";
  if (raw.includes("return") || raw.includes("rts")) return "return";
  if (raw.includes("transit") || raw.includes("ship")) return "transit";
  if (raw.includes("pending") || raw.includes("process")) return "pending";
  return "other";
}

export function brandName(value) {
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

export function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function pick(row, names) {
  const keys = Object.keys(row);
  for (const name of names) {
    const exact = keys.find((key) => headerKey(key) === headerKey(name));
    if (exact && String(row[exact] || "").trim()) return String(row[exact]).trim();
  }
  const loose = keys.find((key) => names.some((name) => headerKey(key).includes(headerKey(name))));
  return loose ? String(row[loose] || "").trim() : "";
}

function headerKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseDate(value, year, month) {
  const raw = String(value || "").trim();
  const fallback = `${year}-${String(month).padStart(2, "0")}-01`;
  if (!raw) return fallback;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const dateTime = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (dateTime) {
    const parsedYear = dateTime[3].length === 2 ? `20${dateTime[3]}` : dateTime[3];
    return `${parsedYear}-${String(dateTime[1]).padStart(2, "0")}-${String(dateTime[2]).padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return fallback;
}

function hashMini(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(16);
}
