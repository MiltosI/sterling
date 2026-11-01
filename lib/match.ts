// Matches Partly parts for a vehicle against yard stock.
//  1. Exact: stock part number (cleaned) equals any of the part's OE numbers.
//  2. "May fit": stock rows with no part number whose vehicle text names the same make and model
//     and whose description reads as the same part type. Rows are dropped when they state a
//     different generation, a year more than YEAR_TOLERANCE from the car's, or the other side.
import type { PartlyPart, PartlyVehicle } from "./partly.ts";
import { partKey, type Source, type StockRow } from "./stock.ts";

export const MAY_FIT_LABEL = "may fit, check with Sterling";

/** Years either side of the Partly vehicle's year that a "may fit" row can be from. */
const YEAR_TOLERANCE = 2;

export interface StockHit {
  yard: Source;
  ref: string;
  price: number | null;
  condition: string | null;
  qty: number | null;
  partNumber: string | null;
  description: string; // the yard's own wording for the part
  vehicle: string; // the yard's own wording for the donor car
}

export interface PartInStock extends PartlyPart {
  stock: (StockHit & { matchedOe: string })[];
}

export interface PartMayFit extends PartlyPart {
  stock: StockHit[];
}

export interface VehicleStockMatch {
  inStockCount: number;
  inStockSummary: string; // e.g. "14 of 32 parts in stock"
  inStock: PartInStock[];
  mayFit: { label: typeof MAY_FIT_LABEL; parts: PartMayFit[] };
}

const hit = (r: StockRow): StockHit => ({
  yard: r.source,
  ref: r.ref,
  price: r.price,
  condition: r.condition,
  qty: r.qty,
  partNumber: r.partNumber,
  description: r.part,
  vehicle: r.vehicle,
});

/** Index stock rows that have a part number by their cleaned key. Build once per stock load. */
export function indexByPartKey(rows: StockRow[]): Map<string, StockRow[]> {
  const index = new Map<string, StockRow[]>();
  for (const r of rows) {
    if (!r.partKey) continue;
    const list = index.get(r.partKey);
    if (list) list.push(r);
    else index.set(r.partKey, [r]);
  }
  return index;
}

export function matchVehicleStock(
  vehicle: PartlyVehicle,
  parts: PartlyPart[],
  index: Map<string, StockRow[]>,
  allRows: StockRow[],
): VehicleStockMatch {
  // --- exact part-number matches ---
  const inStock: PartInStock[] = [];
  for (const part of parts) {
    const seen = new Set<StockRow>();
    const stock: PartInStock["stock"] = [];
    for (const oe of part.oe_numbers) {
      const key = partKey(oe);
      for (const row of (key && index.get(key)) || []) {
        if (seen.has(row)) continue;
        seen.add(row);
        stock.push({ ...hit(row), matchedOe: oe });
      }
    }
    if (stock.length) inStock.push({ ...part, stock });
  }

  // --- "may fit": no part number, same make/model/part type ---
  const candidates = allRows.filter(
    (r) => !r.partNumber && sameVehicle(r.vehicle, vehicle) && yearsCompatible(r.years, vehicle.year),
  );
  const classified = candidates.map((r) => ({ row: r, ...classifyPart(r.part) }));
  const mayFit: PartMayFit[] = [];
  for (const part of parts) {
    const stock = classified
      .filter((c) => c.types.has(part.part_type) && sideCompatible(c.side, part.position))
      .map((c) => hit(c.row));
    if (stock.length) mayFit.push({ ...part, stock });
  }

  return {
    inStockCount: inStock.length,
    inStockSummary: `${inStock.length} of ${parts.length} parts in stock`,
    inStock,
    mayFit: { label: MAY_FIT_LABEL, parts: mayFit },
  };
}

// ---------- vehicle text matching ----------

const MAKE_ALIASES: Record<string, string[]> = {
  "volkswagen": ["volkswagen", "vw"],
  "vauxhall": ["vauxhall", "vaux"],
  "land rover": ["land rover", "landrover", "lr"],
  "mercedes-benz": ["mercedes benz", "mercedes", "merc"],
};
const OTHER_MAKES = ["audi", "bmw", "citroen", "fiat", "ford", "honda", "hyundai", "kia", "mazda", "mini",
  "nissan", "peugeot", "renault", "seat", "skoda", "toyota", "volvo"];

const tokens = (s: string) =>
  s.toLowerCase().replace(/v\.w\./g, "vw").split(/[^a-z0-9.]+/).map((t) => t.replace(/^\.+|\.+$/g, "")).filter(Boolean);

function canonicalMake(make: string): string {
  const m = tokens(make).join(" ");
  for (const [canon, aliases] of Object.entries(MAKE_ALIASES)) if (aliases.includes(m) || canon === m) return canon;
  return m;
}

function makesIn(text: string): Set<string> {
  const joined = ` ${tokens(text).join(" ")} `;
  const found = new Set<string>();
  for (const [canon, aliases] of Object.entries(MAKE_ALIASES))
    if (aliases.some((a) => joined.includes(` ${a} `))) found.add(canon);
  for (const m of OTHER_MAKES) if (joined.includes(` ${m} `)) found.add(m);
  return found;
}

const SIDE_TOKENS = new Set(["os", "ns", "lh", "rh"]);

/** Generation-looking token: Mk6, Mk7.5, F30, W176, XP130, J11, 8V, 5F, BM, PD, QL. */
function looksLikeGeneration(tok: string, vehicleGen: string): boolean {
  if (SIDE_TOKENS.has(tok)) return false;
  if (/^mk\d+(\.\d+)?$|^[a-z]{1,2}\d{1,3}$|^\d[a-z]$|^[a-z]{2}$/.test(tok)) return true;
  // single letters (Corsa D/E) only count when the vehicle's own generation is a single letter
  return /^[a-z]$/.test(tok) && /^[a-z]$/.test(vehicleGen);
}

/**
 * True when the stock row's vehicle text names this model, doesn't name a different make,
 * and doesn't name a different generation straight after the model (e.g. "Fiesta Mk6" vs a Mk7.5).
 */
function sameVehicle(text: string, v: PartlyVehicle): boolean {
  const toks = tokens(text);
  const model = tokens(v.model);
  let at = -1;
  for (let i = 0; i + model.length <= toks.length; i++) {
    if (model.every((m, j) => toks[i + j] === m)) { at = i; break; }
  }
  if (at < 0) return false;

  const makes = makesIn(text);
  if (makes.size && !makes.has(canonicalMake(v.make))) return false;

  const gen = tokens(v.generation ?? "").join("");
  const next = toks[at + model.length];
  if (gen && next && looksLikeGeneration(next, gen) && next !== gen) return false;
  return true;
}

/** Unknown years pass; otherwise the row's year range must come within YEAR_TOLERANCE of the car's year. */
function yearsCompatible(years: [number, number] | null, year: number | undefined): boolean {
  if (!years || !year) return true;
  return years[1] >= year - YEAR_TOLERANCE && years[0] <= year + YEAR_TOLERANCE;
}

// ---------- part type & side from free text ----------

type Side = "nearside" | "offside" | null;

// Order matters: more specific phrases first. Each rule yields one or more Partly part_types.
const PART_RULES: [RegExp, (t: string) => string[]][] = [
  [/airbag/, () => ["airbag_driver"]],
  [/\b(ecu)\b/, () => ["ecu"]],
  [/\b(rad(iator)?|cooling)\s*fan\b/, () => ["radiator_fan"]],
  [/condenser|\b(aircon|a\/?c)\s*rad/, () => ["condenser"]],
  [/\brad(iator)?\b/, () => ["radiator"]],
  [/mirror/, () => ["door_mirror"]],
  [/window\s*(reg(ulator)?|motor)/, () => ["window_regulator"]],
  [/head\s*(lamp|light)/, () => ["headlamp"]],
  [/tail\s*(lamp|light)|\b(rear|back)\s*(lamp|light)\b/, () => ["rear_lamp"]],
  [/\b(lamp|light)\b/, () => ["headlamp", "rear_lamp"]],
  [/bumper/, (t) => frontOrRear(t, "front_bumper", "rear_bumper")],
  [/\bdoor\b/, (t) => frontOrRear(t, "front_door", "rear_door")],
  [/\bwing\b/, () => ["front_wing"]],
  [/tailgate|\bboot\b/, () => ["tailgate"]],
  [/bonnet|\bhood\b/, () => ["bonnet"]],
  [/grill/, () => ["grille"]],
  [/seat\s*belt|\bbelt\b/, (t) => (/\b(rear|back)\b/.test(t) ? [] : ["seatbelt_front"])],
  [/drive\s*shaft/, () => ["driveshaft"]],
  [/starter/, () => ["starter_motor"]],
  [/\balt(ernator)?\b/, () => ["alternator"]],
  [/gear\s*box|g\/box/, () => ["gearbox"]],
  [/\bengine\b/, () => ["engine"]],
  [/alloy|\bwheel\b/, () => ["alloy_wheel"]],
];

function frontOrRear(t: string, front: string, rear: string): string[] {
  const isRear = /\b(rear|back|r)\b/.test(t);
  const isFront = /\b(front|f)\b/.test(t); // "Door F nearside"
  if (isRear && !isFront) return [rear];
  if (isFront && !isRear) return [front];
  return [front, rear]; // not stated: could be either
}

function classifyPart(desc: string): { types: Set<string>; side: Side } {
  const t = ` ${desc.toLowerCase()} `;
  let types: string[] = [];
  for (const [re, toTypes] of PART_RULES) {
    if (re.test(t)) { types = toTypes(t); break; }
  }
  // UK convention: offside = driver = right, nearside = passenger = left
  const near = /\b(n\/s|ns|nearside|left|lh|passenger)\b/.test(t);
  const off = /\b(o\/s|os|offside|right|rh|driver)\b/.test(t);
  const side: Side = near && !off ? "nearside" : off && !near ? "offside" : null;
  return { types: new Set(types), side };
}

/** Front/rear positions are handled by part_type; only nearside/offside can conflict. */
function sideCompatible(stockSide: Side, partPosition: string | undefined): boolean {
  if (!stockSide || (partPosition !== "nearside" && partPosition !== "offside")) return true;
  return stockSide === partPosition;
}
