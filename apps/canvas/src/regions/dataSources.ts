/** Local CSV evidence. Importing a table never creates computational bindings. */
import { calculate, parse } from "../notebook/math.ts";
export type CsvData = { name: string; csv: string };
const csvCache = new Map<string, { headers: string[]; rows: string[][] }>();
export function readCsv(data: CsvData) {
  if (
    !data ||
    typeof data.name !== "string" ||
    !data.name.trim() ||
    data.name.length > 160 ||
    typeof data.csv !== "string" ||
    data.csv.length > 1_000_000
  )
    throw Error("Use a named CSV under 1 MB.");
  const cached = csvCache.get(data.csv);
  if (cached) return cached;
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const text = data.csv.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!quoted && cell.length) throw Error("Quote a whole CSV cell.");
      else {
        closed = quoted;
        quoted = !quoted;
      }
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(cell);
      cell = "";
      closed = false;
      if (c === "\n") {
        rows.push(row);
        row = [];
      }
    } else {
      if (closed && !quoted)
        throw Error("Unexpected text after a quoted CSV cell.");
      cell += c;
    }
  }
  if (quoted) throw Error("A CSV quote is not closed.");
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  while (rows.at(-1)?.every((v) => !v.trim())) rows.pop();
  const headers = rows.shift();
  if (
    !headers?.length ||
    headers.length > 12 ||
    !rows.length ||
    rows.length > 10000 ||
    rows.some((r) => r.length !== headers.length) ||
    headers.some((h) => !h.trim() || h.length > 100) ||
    new Set(headers).size !== headers.length
  )
    throw Error(
      "Use 1–12 distinct columns and 1–10,000 rows with matching column counts.",
    );
  const parsed = { headers, rows };
  rows.forEach(Object.freeze);
  Object.freeze(headers);
  Object.freeze(rows);
  Object.freeze(parsed);
  if (csvCache.size >= 4) csvCache.delete(csvCache.keys().next().value!);
  csvCache.set(data.csv, parsed);
  return parsed;
}
export const numericCell = (raw: string) =>
  raw.length <= 100 &&
  /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(raw.trim()) &&
  Number.isFinite(Number(raw)) &&
  Math.abs(Number(raw)) <= 1e12;
export function csvQuantity(
  data: CsvData,
  row: number,
  column: number,
  name: string,
  unit: string,
) {
  const table = readCsv(data),
    raw = table.rows[row]?.[column];
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(column) ||
    raw === undefined ||
    !numericCell(raw)
  )
    throw Error("Choose a numeric measurement cell.");
  if (
    !/^[A-Za-z_][A-Za-z_0-9]*$/.test(name) ||
    ["__proto__", "constructor", "prototype"].includes(name) ||
    unit.length > 80 ||
    /[\n:=<>]/.test(unit)
  )
    throw Error("Use a quantity name and supported units.");
  const text = measurementText(name, raw, unit);
  parse(text);
  const result = calculate([{ id: "cell", text, x: 0, y: 0 }]);
  if (result.errors.has("cell")) throw Error(result.errors.get("cell"));
  return { text, raw, unit: unit.trim() };
}

/** Unit aliases at the data adapter boundary; the arithmetic engine stays unchanged. */
export function measurementText(name: string, raw: string, unit: string) {
  if (
    !numericCell(raw) ||
    !/^[A-Za-z_][A-Za-z_0-9]*$/.test(name) ||
    ["__proto__", "constructor", "prototype"].includes(name) ||
    unit.length > 80 ||
    /[\n:=<>]/.test(unit)
  )
    throw Error(
      "Use a numeric measurement, quantity name and supported units.",
    );
  const normalized = unit.trim().replace(/\bN\b/g, "(kg*m/s^2)");
  return `${name} := ${Number(raw)}${normalized && normalized !== "1" ? ` ${normalized}` : ""}`;
}
