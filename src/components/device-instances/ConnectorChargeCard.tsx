"use client";

import type { ConnectorType } from "@prisma/client";

const WH_PER_KWH = 1000;
const MS_PER_HOUR = 3_600_000;

export interface ChargeCardConnector {
  connectorId: number;
  label: string;
  connectorType: ConnectorType;
  maxPowerKw: number | null;
}

export interface ChargeCardRuntime {
  status: string;
  locked: boolean;
  evConnected: boolean;
  activeSession: {
    idTag: string;
    startedAt: string;
    chargeRateKw: number;
    currentEnergyWh: number;
  } | null;
}

function badgeLetter(label: string, connectorId: number): string {
  const trimmed = label.trim();
  return trimmed ? trimmed[trimmed.length - 1].toUpperCase() : String(connectorId);
}

function liveEnergyWh(startedAt: string, chargeRateKw: number, now: Date): number {
  const elapsedMs = Math.max(0, now.getTime() - new Date(startedAt).getTime());
  return (chargeRateKw * WH_PER_KWH * elapsedMs) / MS_PER_HOUR;
}

function formatElapsed(startedAt: string, now: Date): string {
  const totalSeconds = Math.max(0, Math.floor((now.getTime() - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * Generic connector glyph — deliberately not connector-type-specific, matching all
 * `ConnectorType` values. Loosely mirrors the real device's CCS2 socket icon (a ring of pins
 * above two DC-pin tabs — see docs/device-reference/PEVC3107E/screenshots/01-home-dual-plug.png):
 * a tight cluster of pins, no other decoration. An earlier version added a curved "smile" line
 * beneath the pin cluster that isn't part of the real icon and made this read as a cartoon face
 * rather than a connector — removed here.
 */
function ConnectorGlyph({ className }: { className?: string }) {
  // CCS2 inlet as drawn on the real screen (01-home-dual-plug.png): a rounded-square upper housing
  // holding a ring of seven signal pins, above the two large DC-pin rings, all in one outline.
  return (
    <svg viewBox="0 0 80 100" fill="none" stroke="currentColor" strokeWidth={3} className={className}>
      <path d="M40 4c17 0 29 11 29 27 0 9-3 15-8 20H19c-5-5-8-11-8-20C11 15 23 4 40 4Z" />
      {[
        [40, 15],
        [53, 22],
        [53, 36],
        [27, 22],
        [27, 36],
        [40, 43],
        [40, 29],
      ].map(([cx, cy]) => (
        <circle key={`${cx}${cy}`} cx={cx} cy={cy} r={4.2} fill="currentColor" stroke="none" />
      ))}
      <circle cx="24" cy="76" r="13" strokeWidth={5} />
      <circle cx="56" cy="76" r="13" strokeWidth={5} />
      <circle cx="24" cy="76" r="5" fill="currentColor" stroke="none" opacity="0.45" />
      <circle cx="56" cy="76" r="5" fill="currentColor" stroke="none" opacity="0.45" />
    </svg>
  );
}

/** The grey shield-shaped plug badge at the card's top-left (reference: a shield with a white A/B). */
function ShieldBadge({ letter }: { letter: string }) {
  return (
    <svg viewBox="0 0 40 46" className="absolute left-[10px] top-[8px] h-[58px] w-[50px]" aria-hidden>
      <path d="M20 2 36 7v18c0 9-7 15-16 19C11 40 4 34 4 25V7l16-5Z" fill="#9aa3ad" stroke="#c9ced4" strokeWidth="2" />
      <text x="20" y="29" textAnchor="middle" fontSize="22" fontWeight="700" fill="#fff" fontFamily="Arial, sans-serif">
        {letter}
      </text>
    </svg>
  );
}

/**
 * Per-connector charging status card — the Home screen's core UI element, mirroring
 * the real device's Plug A/B cards: connector type, idle prompt or live charging readout, and a
 * Charging/Stop button. Backed by `connector-sessions.ts`'s DB-persisted session state, the
 * module actually wired into the live instance runtime — see runtime.ts.
 */
export function ConnectorChargeCard({
  connector,
  runtime,
  now,
  pending,
  evPending,
  error,
  onStartCharging,
  onStopCharging,
  onClearFault,
  onToggleEv,
  showEvControl = true,
}: {
  connector: ChargeCardConnector;
  runtime: ChargeCardRuntime | null;
  now: Date;
  pending: boolean;
  /** Separate pending flag for the EV plug/unplug control below, so toggling it doesn't read as the Charging/Stop button being busy (and vice versa). */
  evPending: boolean;
  error: string | null;
  onStartCharging: () => void;
  onStopCharging: () => void;
  onClearFault: () => void;
  onToggleEv: () => void;
  /** The reference screen has no plug/unplug control; the 3D twin hides it (plugging happens on the 3D car). */
  showEvControl?: boolean;
}) {
  const status = runtime?.status ?? "Available";
  const session = runtime?.activeSession ?? null;
  const evConnected = runtime?.evConnected ?? false;
  const isPreparing = status === "Preparing" && session !== null;
  const isCharging = status === "Charging" && session !== null;
  const isFaulted = status === "Faulted";

  const idleText = evConnected
    ? "EV connected — click Charging to start."
    : showEvControl
      ? "Please connect the EV or use the Plug in EV control below."
      : "Please connect the EV or click charging button.";
  const charging = "w-full rounded-[6px] py-[10px] text-[34px] font-semibold leading-none text-white shadow-[inset_0_-3px_0_rgba(0,0,0,0.12)] disabled:cursor-not-allowed";

  return (
    <div className="relative flex flex-1 flex-col rounded-[8px] bg-white px-[20px] pb-[18px] pt-[16px] shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
      <ShieldBadge letter={badgeLetter(connector.label, connector.connectorId)} />
      <span className="absolute right-[22px] top-[18px] text-[26px] text-[#555]">{connector.connectorType}</span>

      <ConnectorGlyph
        className={`mx-auto mt-[2px] h-[168px] w-[134px] ${
          isCharging
            ? "text-emerald-500"
            : isPreparing
              ? "text-amber-500 animate-pulse"
              : isFaulted
                ? "text-red-400"
                : evConnected
                  ? "text-sky-400"
                  : "text-[#b9b9b9]"
        }`}
      />

      <div className="mt-[18px] flex min-h-[78px] flex-col items-center justify-center text-center text-[24px] leading-[30px] text-[#222]">
        {isPreparing && session ? (
          <>
            <p className="font-medium text-amber-600">Preparing — authorizing card {session.idTag}…</p>
            <p className="font-mono text-[20px] text-zinc-500">{formatElapsed(session.startedAt, now)}</p>
          </>
        ) : isCharging && session ? (
          <>
            <p className="font-medium text-emerald-600">Charging — card {session.idTag}</p>
            <p className="font-mono text-[20px] text-zinc-500">{formatElapsed(session.startedAt, now)}</p>
            <p>
              {(liveEnergyWh(session.startedAt, session.chargeRateKw, now) / WH_PER_KWH).toFixed(3)} kWh
              <span className="text-zinc-400"> · {session.chargeRateKw} kW</span>
            </p>
          </>
        ) : isFaulted ? (
          <p className="text-red-600">Connector fault — clear it below or from the Lock screen.</p>
        ) : (
          <p className="max-w-[360px]">{idleText}</p>
        )}
      </div>

      {error ? <p className="mt-1 text-center text-[18px] text-red-600">{error}</p> : null}

      <div className="mt-[14px]">
        {isFaulted ? (
          <button type="button" disabled={pending} onClick={onClearFault} className={`${charging} bg-[#e5302b] disabled:opacity-50`}>
            Clear fault
          </button>
        ) : isPreparing ? (
          <button type="button" disabled={pending} onClick={onStopCharging} className={`${charging} bg-[#f0a30a] disabled:opacity-50`}>
            Cancel
          </button>
        ) : isCharging ? (
          <button type="button" disabled={pending} onClick={onStopCharging} className={`${charging} bg-[#e5302b] disabled:opacity-50`}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            // A connected EV with no session yet is always "Preparing" (see connector-sessions.ts's
            // connectEv) — "Available" itself means no EV at all. The reference screen keeps the
            // button full-colour regardless; it just does nothing until an EV is present.
            disabled={pending || !evConnected || status !== "Preparing" || session !== null}
            onClick={onStartCharging}
            className={`${charging} disabled:opacity-100`}
            style={{ background: "linear-gradient(#3fd04f, #2fb83f)" }}
          >
            Charging
          </button>
        )}
      </div>

      {showEvControl ? (
        <button
          type="button"
          disabled={evPending}
          onClick={onToggleEv}
          className={`mt-[10px] w-full rounded-[6px] border px-4 py-[8px] text-[22px] font-medium disabled:opacity-50 ${
            evConnected ? "border-zinc-300 text-zinc-600 hover:bg-zinc-50" : "border-sky-300 text-sky-700 hover:bg-sky-50"
          }`}
        >
          {evConnected ? (isCharging || isPreparing ? "Unplug EV (stops session)" : "Unplug EV") : "Plug in EV"}
        </button>
      ) : null}
    </div>
  );
}
