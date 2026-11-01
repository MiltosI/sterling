"use client";

import { useRef, useState, type FormEvent } from "react";
import type { PartInStock, PartMayFit, StockHit, VehicleStockMatch } from "@/lib/match";
import type { PartlyVehicle } from "@/lib/partly";

// ---------- response types (mirror app/api/lookup/route.ts) ----------

type Vehicle = PartlyVehicle & VehicleStockMatch & { partsTotal: number };

type State =
  | { kind: "idle" }
  | { kind: "loading"; plate: string }
  | { kind: "error"; title: string; message: string }
  | { kind: "pick"; plate: string; vehicles: Vehicle[] }
  | { kind: "result"; plate: string; vehicle: Vehicle; choices: Vehicle[] };

const CATEGORY_ORDER = ["body", "lighting", "mirrors", "cooling", "electrical", "engine", "transmission", "wheels", "safety"];
const CATEGORY_LABEL: Record<string, string> = {
  body: "Body panels",
  lighting: "Lighting",
  mirrors: "Mirrors",
  cooling: "Cooling",
  electrical: "Electrical",
  engine: "Engine",
  transmission: "Transmission",
  wheels: "Wheels",
  safety: "Safety",
};
const YARD_LABEL: Record<string, string> = { tipton: "Tipton", walsall: "Walsall", dudley: "Dudley" };

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

// ---------- main component ----------

export default function PlateSearch() {
  const [plate, setPlate] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const inFlight = useRef<AbortController | null>(null);

  async function search(e: FormEvent) {
    e.preventDefault();
    const query = plate.replace(/\s+/g, "").toUpperCase();
    if (!query) {
      setState({ kind: "error", title: "Enter a number plate", message: "Type the car's registration, e.g. FY17 KXN." });
      return;
    }

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setState({ kind: "loading", plate: query });

    try {
      const res = await fetch(`/api/lookup?plate=${encodeURIComponent(query)}`, { signal: controller.signal });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setState({ kind: "error", ...errorMessage(res.status, query, res.headers.get("retry-after")) });
        return;
      }
      const vehicles: Vehicle[] = body?.vehicles ?? [];
      if (vehicles.length === 0) setState({ kind: "error", ...errorMessage(404, query, null) });
      else if (vehicles.length === 1) setState({ kind: "result", plate: query, vehicle: vehicles[0], choices: vehicles });
      else setState({ kind: "pick", plate: query, vehicles });
    } catch (err) {
      if (controller.signal.aborted) return; // superseded by a newer search
      console.error(err);
      setState({ kind: "error", ...errorMessage(0, query, null) });
    }
  }

  const loading = state.kind === "loading";

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={search} className="flex flex-col gap-3 sm:flex-row" role="search">
        <label htmlFor="plate" className="sr-only">
          Number plate
        </label>
        <input
          id="plate"
          name="plate"
          value={plate}
          onChange={(e) => setPlate(e.target.value.toUpperCase())}
          placeholder="FY17 KXN"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={10}
          className="h-14 flex-1 rounded-lg border-2 border-zinc-900 bg-yellow-300 px-4 text-center font-mono text-2xl font-bold tracking-[0.2em] text-zinc-900 uppercase placeholder:text-zinc-900/30 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/40"
        />
        <button
          type="submit"
          disabled={loading}
          className="flex h-14 items-center justify-center gap-2 rounded-lg bg-zinc-900 px-8 text-lg font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-70 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {loading && <Spinner />}
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      <div aria-live="polite" aria-busy={loading}>
        {state.kind === "loading" && <LoadingSkeleton />}
        {state.kind === "error" && <Notice tone="error" title={state.title} message={state.message} />}
        {state.kind === "pick" && (
          <VehiclePicker
            plate={state.plate}
            vehicles={state.vehicles}
            onPick={(v) => setState({ kind: "result", plate: state.plate, vehicle: v, choices: state.vehicles })}
          />
        )}
        {state.kind === "result" && (
          <Results
            key={`${state.plate}-${state.vehicle.vehicle_id}`}
            plate={state.plate}
            vehicle={state.vehicle}
            onChangeVehicle={
              state.choices.length > 1
                ? () => setState({ kind: "pick", plate: state.plate, vehicles: state.choices })
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
}

function errorMessage(status: number, plate: string, retryAfter: string | null): { title: string; message: string } {
  switch (status) {
    case 400:
      return { title: "That doesn't look like a number plate", message: "Use letters and numbers only, e.g. FY17 KXN." };
    case 404:
      return {
        title: `We couldn't find ${plate}`,
        message: "Check the plate and try again. If it's right, give Sterling a call and we'll look it up for you.",
      };
    case 429:
      return {
        title: "Lots of searches right now",
        message: `Please try again in ${retryAfter ? `${retryAfter} seconds` : "a moment"}.`,
      };
    default:
      return {
        title: "Parts search isn't available right now",
        message: "Something went wrong on our side. Please try again in a minute, or give Sterling a call.",
      };
  }
}

// ---------- vehicle choice ----------

function VehiclePicker({ plate, vehicles, onPick }: { plate: string; vehicles: Vehicle[]; onPick: (v: Vehicle) => void }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Which car is {plate}?</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          This plate matches more than one version. Pick the one you&apos;re working on.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {vehicles.map((v) => (
          <li key={v.vehicle_id}>
            <button
              type="button"
              onClick={() => onPick(v)}
              className="w-full rounded-xl border border-zinc-200 bg-white p-4 text-left transition-colors hover:border-zinc-900 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/40 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-400"
            >
              <div className="font-semibold">
                {v.make} {v.model} {v.variant}
              </div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                {[v.year, v.engine, v.body_type, v.colour].filter(Boolean).join(" · ")}
              </div>
              <div className="mt-2 text-sm font-medium">{v.inStockSummary}</div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- results ----------

function Results({ plate, vehicle, onChangeVehicle }: { plate: string; vehicle: Vehicle; onChangeVehicle?: () => void }) {
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const request = (key: string) => setRequested((prev) => new Set(prev).add(key));

  const groups = groupByCategory(vehicle.inStock);
  const mayFit = vehicle.mayFit.parts;

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">
              {vehicle.make} {vehicle.model}
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400">{vehicle.variant}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {[vehicle.year, vehicle.colour].filter(Boolean).join(" · ")}
            </p>
          </div>
          <span className="shrink-0 rounded border border-zinc-900 bg-yellow-300 px-2 py-0.5 font-mono text-sm font-bold tracking-wider text-zinc-900">
            {plate}
          </span>
        </div>
        <p className="mt-4 text-lg font-semibold">
          {vehicle.inStockCount} of {vehicle.partsTotal} parts in stock
        </p>
        {onChangeVehicle && (
          <button type="button" onClick={onChangeVehicle} className="mt-1 text-sm underline underline-offset-2">
            Not this version? Change vehicle
          </button>
        )}
      </section>

      {groups.length === 0 ? (
        <Notice
          tone="info"
          title="No parts in stock for this car right now"
          message={
            mayFit.length
              ? "We've listed some parts below that may fit. Sterling can confirm."
              : "Give Sterling a call: stock changes daily and we may be able to source it."
          }
        />
      ) : (
        <section className="flex flex-col gap-6">
          <h2 className="text-lg font-semibold">In stock</h2>
          {groups.map(([category, parts]) => (
            <div key={category} className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">
                {CATEGORY_LABEL[category] ?? category}
              </h3>
              {parts.map((part) => (
                <PartCard key={part.partly_part_id} name={part.name} stock={part.stock} requested={requested} onRequest={request} />
              ))}
            </div>
          ))}
        </section>
      )}

      {mayFit.length > 0 && (
        <section className="flex flex-col gap-3 rounded-xl border border-dashed border-amber-400 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30">
          <div>
            <h2 className="text-lg font-semibold">May fit – check with Sterling</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              These parts came off the same model but have no part number on record, so we can&apos;t confirm the
              fit. Request one and Sterling will check before sending.
            </p>
          </div>
          {mayFit.map((part: PartMayFit) => (
            <PartCard key={part.partly_part_id} name={part.name} stock={part.stock} requested={requested} onRequest={request} showListing />
          ))}
        </section>
      )}
    </div>
  );
}

function groupByCategory(parts: PartInStock[]): [string, PartInStock[]][] {
  const map = new Map<string, PartInStock[]>();
  for (const p of parts) map.set(p.category, [...(map.get(p.category) ?? []), p]);
  const rank = (c: string) => (CATEGORY_ORDER.indexOf(c) + 1 || 99);
  return [...map.entries()].sort(([a], [b]) => rank(a) - rank(b));
}

function PartCard({
  name,
  stock,
  requested,
  onRequest,
  showListing = false,
}: {
  name: string;
  stock: StockHit[];
  requested: Set<string>;
  onRequest: (key: string) => void;
  showListing?: boolean;
}) {
  return (
    <article className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <h4 className="border-b border-zinc-100 px-4 py-3 font-medium dark:border-zinc-800">{name}</h4>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {stock.map((s) => {
          const key = `${s.yard}:${s.ref}`;
          const sent = requested.has(key);
          return (
            <li key={key} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-lg font-semibold">{s.price !== null ? gbp.format(s.price) : "Call for price"}</span>
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">{YARD_LABEL[s.yard] ?? s.yard} yard</span>
                </div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {[s.condition ? `Condition: ${s.condition}` : null, `Qty: ${s.qty ?? 1}`].filter(Boolean).join(" · ")}
                </div>
                {showListing && (
                  <div className="text-xs text-zinc-500">
                    Listed as &ldquo;{s.description}&rdquo;{s.vehicle && s.vehicle !== s.description ? ` from ${s.vehicle}` : ""}
                  </div>
                )}
              </div>
              {sent ? (
                <p role="status" className="text-sm font-medium text-green-700 dark:text-green-400">
                  ✓ Request sent to Sterling
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => onRequest(key)}
                  className="h-10 shrink-0 rounded-lg border border-zinc-900 px-4 text-sm font-semibold transition-colors hover:bg-zinc-900 hover:text-white dark:border-zinc-200 dark:hover:bg-zinc-200 dark:hover:text-zinc-900"
                >
                  Request part
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </article>
  );
}

// ---------- small bits ----------

function Notice({ tone, title, message }: { tone: "error" | "info"; title: string; message: string }) {
  const styles =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
      : "border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border p-4 ${styles}`}>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm opacity-90">{message}</p>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-label="Searching for parts">
      <div className="h-36 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-24 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-24 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}
