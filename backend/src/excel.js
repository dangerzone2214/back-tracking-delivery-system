import * as XLSX from "xlsx";

export function readWorkbookRows(buffer, filename = "upload.xlsx") {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel file has no readable sheet.");
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false,
    blankrows: false,
  });
  if (!rows.length) throw new Error(`${filename} has no data rows.`);
  return { sheetName, rows };
}
