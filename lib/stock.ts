// Loads the three yard stock files into one normalised list of sellable stock.
// Server-only: reads files from ./data relative to the project root.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

const DATA_DIR = path.join(process.cwd(), "data");

export type Source = "tipton" | "walsall" | "dudley";

export interface StockRow {
  source: Source;
  ref: string; // row/sheet reference, stock no, or eBay SKU
  part: string;
  partNumber: string | null; // as written in the source
  partKey: string | null; // uppercase, no spaces/dashes — for matching across yards
  qty: number | null;
  price: number | null;
  condition: string | null; // as written by the yard; Tipton doesn't record one
  vehicle: string; // donor car / make+model+year / eBay title, for fuzzy vehicle matching
  years: [number, number] | null; // model year(s) of the donor car, when stated
}

export type SkipReason = "junk" | "sold" | "reserved" | "qty0";

export interface LoadResult {
  rows: StockRow[];
  skipped: Record<SkipReason, number>;
}

const emptySkipped = (): Record<SkipReason, number> => ({ junk: 0, sold: 0, reserved: 0, qty0: 0 });

/** Rows not available to sell. Each row is counted under the first reason that applies. */
function unavailableReason(note: string, qty: number | null): SkipReason | null {
  if (/\bsold\b/i.test(note)) return "sold"; // includes "SOLD 21/10", "sold?", "Sold 03/10"
  if (/\breserved\b/i.test(note)) return "reserved"; // "reserved for Kev", "reserved - Kev", "Reserved"
  if (qty === 0) return "qty0";
  return null;
}

// ---------- helpers ----------

type Cell = ExcelJS.CellValue;

const isFormula = (v: Cell) =>
  typeof v === "object" && v !== null && ("formula" in v || "sharedFormula" in v);

function text(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("").trim();
    if ("text" in v) return String(v.text).trim();
    if ("result" in v) return text(v.result as Cell);
    return "";
  }
  return String(v).trim();
}

function num(v: Cell): number | null {
  const s = text(v).replace(/[£,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Normalised part number for matching: uppercase, letters and digits only. */
export const partKey = (pn: string | null) => (pn ? pn.toUpperCase().replace(/[^A-Z0-9]/g, "") : null);

/**
 * Year or year range in free text: "2012-2015", "2018 i30 red", "Corsa 2013".
 * `allowTwoDigit` accepts "13" as 2013 (Walsall's Yr column only; elsewhere 2-digit numbers are sizes).
 */
function parseYears(s: string, allowTwoDigit = false): [number, number] | null {
  const found = [...s.matchAll(/\b(19[89]\d|20[0-4]\d)\b/g)].map((m) => Number(m[1]));
  if (!found.length && allowTwoDigit && /^\d{2}$/.test(s.trim())) found.push(2000 + Number(s.trim()));
  return found.length ? [Math.min(...found), Math.max(...found)] : null;
}

function cleanPartNumber(v: Cell): string | null {
  const s = text(v).replace(/\s+/g, " ");
  return s ? s.toUpperCase() : null;
}

/** Map lowercased header text -> column index for the first row whose cells include all `required` headers. */
function findHeader(ws: ExcelJS.Worksheet, required: string[]) {
  for (let r = 1; r <= Math.min(ws.rowCount, 20); r++) {
    const cols = new Map<string, number>();
    ws.getRow(r).eachCell((cell, c) => cols.set(text(cell.value).toLowerCase(), c));
    if (required.every((h) => cols.has(h))) return { headerRow: r, cols };
  }
  throw new Error(`Header ${required.join(", ")} not found in sheet "${ws.name}"`);
}

/** Blank rows, TOTAL lines and formula/summary rows. */
function isJunk(values: Cell[], part: string): boolean {
  if (values.some(isFormula)) return true;
  if (/^total\b/i.test(text(values[1]))) return true;
  return part === "";
}

// ---------- part numbers in eBay text ----------

const PART_NO_PATTERNS = [
  // VAG: 5F0 941 295, 2G0-826-236-E, 2G0 997 186 A
  /\b\d[A-Z]\d[ -]?\d{3}[ -]?\d{3}(?:[ -]?[A-Z]{1,2}(?![A-Z0-9]))?/gi,
  // Ford: 8A61-12W644-AC, 8A61 14C124 AA, GV41-12K820-AC
  // (middle block must mix letters and digits, so "2014 MIRROR RH" doesn't match)
  /\b[A-Z0-9]{4}[ -](?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,6}[ -][A-Z]{2}\b/gi,
  // Single token, e.g. 16163739, BHN1501205, 58724-0H630, 73034JD03A
  /(?<![#\w-])[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gi,
];

const SIDE_WORDS = /^(LH|RH|OS|NS)$/i;

function looksLikePartNumber(tok: string): boolean {
  const alnum = tok.replace(/[^A-Z0-9]/gi, "");
  const digits = alnum.replace(/\D/g, "").length;
  if (alnum.length < 7 || digits < 4) return false;
  if (/^(19|20)\d\d-(19|20)\d\d$/.test(tok)) return false; // year range
  return true;
}

function partNumberFromTitle(title: string): string | null {
  for (const re of PART_NO_PATTERNS) {
    for (const m of title.matchAll(re)) {
      let tok = m[0].trim();
      // drop a trailing side word swallowed by the VAG suffix, e.g. "5F0 850 781 RH"
      const parts = tok.split(/[ -]/);
      if (parts.length > 3 && SIDE_WORDS.test(parts.at(-1)!)) tok = tok.slice(0, -parts.at(-1)!.length - 1);
      if (looksLikePartNumber(tok)) return tok.toUpperCase();
    }
  }
  return null;
}

function partNumberFromDescription(desc: string): string | null {
  const m = desc.match(/Part number:\s*([A-Z0-9][A-Z0-9 \-]*[A-Z0-9])/i);
  return m ? m[1].toUpperCase() : null;
}

// ---------- loaders ----------

async function loadTipton(): Promise<LoadResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(DATA_DIR, "tipton_stock.xlsx"));
  const ws = wb.getWorksheet("Tipton");
  if (!ws) throw new Error("Tipton sheet missing"); // "old stock DO NOT USE" tab is deliberately ignored
  const { headerRow, cols } = findHeader(ws, ["donor car", "part", "part no.", "qty", "notes"]);

  const out: LoadResult = { rows: [], skipped: emptySkipped() };
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const values = ws.getRow(r).values as Cell[];
    const part = text(values[cols.get("part")!]);
    if (isJunk(values, part)) { out.skipped.junk++; continue; }
    const why = unavailableReason(text(values[cols.get("notes")!]), num(values[cols.get("qty")!]));
    if (why) { out.skipped[why]++; continue; }
    const pn = cleanPartNumber(values[cols.get("part no.")!]);
    out.rows.push({
      source: "tipton",
      ref: `Tipton!R${r}`,
      part,
      partNumber: pn,
      partKey: partKey(pn),
      qty: num(values[cols.get("qty")!]),
      price: num(values[cols.get("£")!]),
      condition: null,
      vehicle: text(values[cols.get("donor car")!]),
      years: parseYears(text(values[cols.get("donor car")!])),
    });
  }
  return out;
}

async function loadWalsall(): Promise<LoadResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(DATA_DIR, "walsall_stock.xlsx"));
  const ws = wb.getWorksheet("Stock");
  if (!ws) throw new Error("Walsall Stock sheet missing");
  const { headerRow, cols } = findHeader(ws, ["stock no", "make", "model", "yr", "part", "part no", "cond", "status"]);

  const out: LoadResult = { rows: [], skipped: emptySkipped() };
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const values = ws.getRow(r).values as Cell[];
    const part = text(values[cols.get("part")!]);
    if (isJunk(values, part) || !text(values[cols.get("stock no")!])) { out.skipped.junk++; continue; }
    // Walsall has no notes or qty column: Status holds sold/reserved, and each row is one item
    const why = unavailableReason(text(values[cols.get("status")!]), 1);
    if (why) { out.skipped[why]++; continue; }
    const pn = cleanPartNumber(values[cols.get("part no")!]);
    out.rows.push({
      source: "walsall",
      ref: text(values[cols.get("stock no")!]),
      part,
      partNumber: pn,
      partKey: partKey(pn),
      qty: 1, // Walsall lists one row per item
      price: num(values[cols.get("price")!]),
      condition: text(values[cols.get("cond")!]) || null,
      vehicle: ["make", "model", "yr"].map((h) => text(values[cols.get(h)!])).filter(Boolean).join(" "),
      years: parseYears(text(values[cols.get("yr")!]), true),
    });
  }
  return out;
}

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, newlines in quotes). */
function parseCsv(src: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadDudley(): LoadResult & { partNumberSources: Record<string, number> } {
  const raw = readFileSync(path.join(DATA_DIR, "dudley_ebay_export.csv"), "utf8")
    .replace(/^﻿/, "")
    .replace(/Â£/g, "£"); // export double-encodes the pound sign
  const [header, ...records] = parseCsv(raw);
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Dudley CSV missing column "${name}"`);
    return i;
  };
  const C = {
    item: col("Item number"), title: col("Title"), sku: col("Custom label (SKU)"),
    qty: col("Available quantity"), price: col("Current price"), desc: col("Item description"),
    cond: col("Condition"),
  };

  const out = { rows: [] as StockRow[], skipped: emptySkipped(), partNumberSources: { description: 0, title: 0, none: 0 } };
  for (const rec of records) {
    const title = (rec[C.title] ?? "").trim();
    if (!title || !/^\d+$/.test((rec[C.item] ?? "").trim())) { out.skipped.junk++; continue; }
    const desc = rec[C.desc] ?? "";
    // No notes column in the eBay export; the description is the closest thing to one
    const why = unavailableReason(desc, num(rec[C.qty]));
    if (why) { out.skipped[why]++; continue; }
    let pn = partNumberFromDescription(desc);
    if (pn) out.partNumberSources.description++;
    else if ((pn = partNumberFromTitle(title))) out.partNumberSources.title++;
    else out.partNumberSources.none++;
    out.rows.push({
      source: "dudley",
      ref: rec[C.sku] || rec[C.item],
      part: title,
      partNumber: pn,
      partKey: partKey(pn),
      qty: num(rec[C.qty]),
      price: num(rec[C.price]),
      condition: rec[C.cond]?.trim() || null,
      vehicle: title,
      years: parseYears(title),
    });
  }
  return out;
}

// ---------- public API ----------

export interface StockData {
  rows: StockRow[];
  bySource: Record<Source, LoadResult>;
  dudleyPartNumberSources: Record<"description" | "title" | "none", number>;
  loadedAt: string;
}

export async function loadAllStock(): Promise<StockData> {
  const [tipton, walsall] = await Promise.all([loadTipton(), loadWalsall()]);
  const { partNumberSources, ...dudley } = loadDudley();
  return {
    rows: [...tipton.rows, ...walsall.rows, ...dudley.rows],
    bySource: { tipton, walsall, dudley },
    dudleyPartNumberSources: partNumberSources,
    loadedAt: new Date().toISOString(),
  };
}

const DATA_FILES = ["tipton_stock.xlsx", "walsall_stock.xlsx", "dudley_ebay_export.csv"];
let cache: { signature: string; data: Promise<StockData> } | null = null;

/** loadAllStock(), cached in memory until one of the data files changes on disk. */
export function getStock(): Promise<StockData> {
  const signature = DATA_FILES.map((f) => statSync(path.join(DATA_DIR, f)).mtimeMs).join("|");
  if (cache?.signature !== signature) {
    const data = loadAllStock();
    data.catch(() => { if (cache?.data === data) cache = null; }); // don't cache failures
    cache = { signature, data };
  }
  return cache.data;
}
