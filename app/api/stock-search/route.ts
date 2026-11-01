import type { NextRequest } from "next/server";
import { getStock, partKey, type Source } from "@/lib/stock";

// GET /api/stock-search?pn=5F0 941 295
// Finds sellable stock across all three yards whose part number matches, ignoring case, spaces and dashes.
export async function GET(request: NextRequest) {
  const pn = request.nextUrl.searchParams.get("pn")?.trim() ?? "";
  const key = partKey(pn);
  if (!key || key.length < 4) {
    return Response.json(
      { error: "Pass a part number of at least 4 letters/digits, e.g. /api/stock-search?pn=5F0941295" },
      { status: 400 },
    );
  }

  const { rows, loadedAt } = await getStock();
  const results = rows.filter((r) => r.partKey === key);

  const yards: Record<Source, { listings: number; qty: number }> = {
    tipton: { listings: 0, qty: 0 },
    walsall: { listings: 0, qty: 0 },
    dudley: { listings: 0, qty: 0 },
  };
  for (const r of results) {
    yards[r.source].listings++;
    yards[r.source].qty += r.qty ?? 0;
  }

  return Response.json({
    query: pn,
    key,
    count: results.length,
    totalQty: results.reduce((n, r) => n + (r.qty ?? 0), 0),
    yards,
    results,
    loadedAt,
  });
}
