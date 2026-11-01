import type { NextRequest } from "next/server";
import { indexByPartKey, matchVehicleStock } from "@/lib/match";
import { getAllParts, lookupVehicles, PartlyError } from "@/lib/partly";
import { getStock, type StockRow } from "@/lib/stock";

// GET /api/lookup?plate=FY17 KXN
// Looks up the vehicle(s) for a UK plate via Partly, fetches every part that fits each one,
// and matches those parts against yard stock (see lib/match.ts).

// Part-number index, rebuilt only when getStock() returns a fresh load
const indexes = new WeakMap<StockRow[], Map<string, StockRow[]>>();
function indexFor(rows: StockRow[]) {
  let index = indexes.get(rows);
  if (!index) indexes.set(rows, (index = indexByPartKey(rows)));
  return index;
}
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("plate") ?? "";
  const plate = raw.replace(/\s+/g, "").toUpperCase();

  if (!plate) {
    return error(400, "missing_plate", "Pass a registration, e.g. /api/lookup?plate=FY17 KXN");
  }
  if (!/^[A-Z0-9]+$/.test(plate)) {
    return error(400, "invalid_plate", `"${raw}" is not a valid registration: use letters and digits only`);
  }

  try {
    const [matches, stock] = await Promise.all([lookupVehicles(plate), getStock()]);
    const index = indexFor(stock.rows);
    const vehicles = await Promise.all(
      matches.map(async (vehicle) => {
        const { total, parts } = await getAllParts(vehicle.vehicle_id);
        return { ...vehicle, partsTotal: total, ...matchVehicleStock(vehicle, parts, index, stock.rows), parts };
      }),
    );
    return Response.json({ plate, vehicles });
  } catch (err) {
    if (err instanceof PartlyError) return partlyErrorResponse(err, plate);
    throw err;
  }
}

function error(status: number, code: string, message: string, headers?: HeadersInit) {
  return Response.json({ error: code, message }, { status, headers });
}

function partlyErrorResponse(err: PartlyError, plate: string) {
  const retry = err.retryAfter ? { "Retry-After": err.retryAfter } : undefined;
  switch (err.status) {
    case 400:
      return error(400, err.code, `Partly rejected the registration "${plate}": ${err.message}`);
    case 401:
      // Our server's token is wrong, not the caller's credentials, so this is a 502, not a 401
      return error(502, err.code,
        `Partly rejected our API token (${err.code}). Check PARTLY_TOKEN in the server environment.`);
    case 404:
      return error(404, err.code, `No vehicle found for registration ${plate}`);
    case 429:
      return error(429, err.code,
        `Partly rate limit reached (30 requests/minute). Try again in ${err.retryAfter ?? "a few"} seconds.`, retry);
    case 503:
      return error(503, err.code, "Partly is temporarily unavailable. Try again shortly.", retry);
    case 0: // our config problem, timeout or network failure
      return error(err.code === "missing_config" ? 500 : 503, err.code, err.message);
    default:
      return error(502, err.code, `Unexpected response from Partly (HTTP ${err.status}): ${err.message}`);
  }
}
