// Logs a summary of the loaded stock. Run from the project root with: node scripts/load-stock.ts
import { loadAllStock } from "../lib/stock.ts";

const { rows, bySource, dudleyPartNumberSources } = await loadAllStock();

for (const [name, res] of Object.entries(bySource)) {
  const withPn = res.rows.filter((r) => r.partNumber).length;
  console.log(
    `${name.padEnd(8)} kept ${String(res.rows.length).padStart(4)}  ` +
      `(with part no ${withPn}, without ${res.rows.length - withPn})  ` +
      `skipped: sold ${res.skipped.sold}, reserved ${res.skipped.reserved}, ` +
      `qty 0 ${res.skipped.qty0}, junk ${res.skipped.junk}`,
  );
}
console.log("dudley part numbers found in:", dudleyPartNumberSources);
console.log(`total kept: ${rows.length}`);
console.log("\nfirst 5 rows of each source:");
for (const res of Object.values(bySource)) console.table(res.rows.slice(0, 5));
