import Link from "next/link";

/** Blue top bar matching the real device's Setting screens — home icon + instance name. */
export function DeviceHeaderBar({ instanceId, title }: { instanceId: string; title: string }) {
  return (
    <div className="flex items-center gap-3 bg-blue-600 px-4 py-3 text-white">
      <Link
        href={`/instances/${instanceId}`}
        title="Back to device"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/15 hover:bg-white/25"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <path d="M3 11.5 12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
      <span className="truncate text-sm font-medium">{title}</span>
    </div>
  );
}
