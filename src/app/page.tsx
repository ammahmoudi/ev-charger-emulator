export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-col items-center gap-3 px-6 text-center">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          EV Charger Emulator
        </h1>
        <p className="max-w-md text-zinc-600 dark:text-zinc-400">
          Multi-device EV charge point emulator. Device instances aren&apos;t implemented yet —
          see the repo&apos;s Issues for the build plan.
        </p>
      </main>
    </div>
  );
}
