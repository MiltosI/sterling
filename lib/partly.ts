// Minimal client for the Partly Parts API (see 02_API_DOCS.md). Server-only.

const BASE_URL = (process.env.PARTLY_BASE_URL ?? "http://localhost:4000/v1").replace(/\/+$/, "");
const PAGE_SIZE = 50; // API maximum: fewer requests against the 30/min rate limit
const MAX_PAGES = 100; // guard against an upstream next_page loop
const TIMEOUT_MS = 10_000;

export interface PartlyVehicle {
  vehicle_id: string;
  make: string;
  model: string;
  generation?: string;
  variant?: string;
  year?: number;
  engine?: string;
  fuel?: string;
  body_type?: string;
  colour?: string;
  vin?: string;
}

export interface PartlyPart {
  partly_part_id: string;
  part_type: string;
  name: string;
  category: string;
  position?: string;
  oe_numbers: string[]; // first is current, the rest are superseded numbers
}

interface LookupResponse {
  registration: string;
  matches: PartlyVehicle[];
}

interface PartsPage {
  vehicle_id: string;
  page: number;
  page_size: number;
  total: number;
  next_page: number | null;
  parts: PartlyPart[];
}

/** A failed call to Partly. `status` is Partly's HTTP status, or 0 when it couldn't be reached. */
// (plain fields rather than constructor parameter properties so plain `node` can run this file)
export class PartlyError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter: string | null;

  constructor(status: number, code: string, message: string, retryAfter: string | null = null) {
    super(message);
    this.name = "PartlyError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

async function partlyGet<T>(pathAndQuery: string): Promise<T> {
  const token = process.env.PARTLY_TOKEN;
  if (!token) throw new PartlyError(0, "missing_config", "PARTLY_TOKEN is not set on the server");

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${pathAndQuery}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new PartlyError(0, timedOut ? "timeout" : "unreachable",
      timedOut ? `Partly did not respond within ${TIMEOUT_MS / 1000}s` : `Could not reach Partly at ${BASE_URL}`);
  }

  if (res.ok) return (await res.json()) as T;

  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  throw new PartlyError(
    res.status,
    body.error ?? `http_${res.status}`,
    body.message ?? body.error ?? res.statusText,
    res.headers.get("retry-after"),
  );
}

/** `registration` must already be uppercase letters/digits with no spaces. */
export async function lookupVehicles(registration: string): Promise<PartlyVehicle[]> {
  const data = await partlyGet<LookupResponse>(
    `/vehicles/lookup?registration=${encodeURIComponent(registration)}`,
  );
  return data.matches ?? [];
}

/** Every part that fits the vehicle, following next_page until the last page. */
export async function getAllParts(vehicleId: string): Promise<{ total: number; parts: PartlyPart[] }> {
  const parts: PartlyPart[] = [];
  let total = 0;
  let page: number | null = 1;
  for (let fetched = 0; page !== null; fetched++) {
    if (fetched >= MAX_PAGES) {
      throw new PartlyError(0, "too_many_pages", `Partly returned more than ${MAX_PAGES} pages for ${vehicleId}`);
    }
    const data: PartsPage = await partlyGet<PartsPage>(
      `/vehicles/${encodeURIComponent(vehicleId)}/parts?page=${page}&page_size=${PAGE_SIZE}`,
    );
    parts.push(...data.parts);
    total = data.total;
    page = data.next_page;
  }
  return { total, parts };
}
