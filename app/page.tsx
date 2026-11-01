import PlateSearch from "./plate-search";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans text-zinc-900 dark:bg-black dark:text-zinc-100">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:py-14">
        <header className="flex flex-col gap-1">
          <p className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">Sterling Auto Recyclers</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Find used parts by number plate</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Enter the car&apos;s registration to see what we have across our Tipton, Walsall and Dudley yards.
          </p>
        </header>
        <PlateSearch />
      </main>
    </div>
  );
}
