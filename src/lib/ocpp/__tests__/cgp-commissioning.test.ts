/**
 * CGP-0012/0013 commissioning + overshoot evidence over the REAL OCPP 1.6J wire.
 *
 * A real `OcppClient` + `OcppChargePointSession` + `registerRemoteCommandHandlers` (the emulator's own charging
 * simulation: cumulative Wh register, periodic MeterValues, RemoteStart/RemoteStop, ChangeConfiguration) talk over a
 * real WebSocket to a minimal CSMS that records every frame with a receive timestamp. Nothing is mocked inside the
 * emulator. The measurements describe THIS EMULATOR, not a physical charger: a real station must be commissioned
 * separately and its numbers are what a capability record must carry.
 *
 * Run: `npx vitest run src/lib/ocpp/__tests__/cgp-commissioning.test.ts`
 * Set CGP_EVIDENCE_OUT=<file> to write the evidence JSON (consumed by the adapter's capability PUT).
 */
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";

import { InMemoryConfigurationStore, OcppChargePointSession, OcppClient, registerRemoteCommandHandlers } from "../index";
import type { RemoteCommandHandlers } from "../remote-command-types";
import { MockCsmsServer } from "./mock-csms-server";

const RATE_KW = 72; // 20 Wh/s: fast enough to measure in seconds, slow enough to sample
const RATE_WH_PER_S = (RATE_KW * 1000) / 3600;
function commissioningInterval(raw: string | undefined): 1 | 4 {
  if (raw === undefined || raw === "1") return 1;
  if (raw === "4") return 4;
  throw new Error("CGP_COMMISSIONING_METER_INTERVAL_S must be exactly 1 or 4");
}
const METER_INTERVAL_S = commissioningInterval(process.env.CGP_COMMISSIONING_METER_INTERVAL_S);
const evidenceOut = process.env.CGP_EVIDENCE_OUT;
// The 4-second calibration always writes a new protected artifact, never the checked-in 1-second proof.
const privateOutputFd = METER_INTERVAL_S === 4 ? (() => {
  if (!evidenceOut || !isAbsolute(evidenceOut) || resolve(evidenceOut) !== evidenceOut) throw new Error("4-second calibration requires an absolute private CGP_EVIDENCE_OUT");
  const parent = dirname(evidenceOut), stat = lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || realpathSync(parent) !== parent) throw new Error("Calibration parent must be an existing real mode0700 private directory");
  const fd = openSync(evidenceOut, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  if ((fstatSync(fd).mode & 0o777) !== 0o600) { closeSync(fd); throw new Error("Calibration evidence must be mode0600"); }
  return fd;
})() : undefined;
const TRIALS = 5;
const REGISTER = "Energy.Active.Import.Register";

interface Frame { at: number; frame: unknown[] }

/** CSMS side of one charge point socket: answers the CP's calls, records every frame, can issue its own calls. */
class WireCsms {
  readonly frames: Frame[] = [];
  private nextTx = 100;
  /** StartTransaction call id -> transactionId this CSMS issued for it. */
  readonly issuedTx = new Map<string, number>();
  private seq = 0;
  private readonly pending = new Map<string, (r: { at: number; payload: unknown; error?: unknown }) => void>();
  private readonly waiters: Array<{ match: (f: Frame) => boolean; resolve: (f: Frame) => void }> = [];

  constructor(private readonly ws: WebSocket) {
    ws.on("message", (data) => this.onMessage(JSON.parse((data as Buffer).toString()) as unknown[]));
  }

  private onMessage(frame: unknown[]): void {
    const f: Frame = { at: Date.now(), frame };
    this.frames.push(f);
    if (frame[0] === 2) {
      const [, id, action] = frame as [number, string, string];
      const result: Record<string, unknown> =
        action === "BootNotification" ? { status: "Accepted", currentTime: new Date().toISOString(), interval: 300 }
        : action === "Heartbeat" ? { currentTime: new Date().toISOString() }
        : action === "StartTransaction" ? this.issue(id)
        : action === "StopTransaction" || action === "Authorize" ? { idTagInfo: { status: "Accepted" } }
        : {};
      this.ws.send(JSON.stringify([3, id, result]));
    } else if (frame[0] === 3 || frame[0] === 4) {
      const cb = this.pending.get(frame[1] as string);
      if (cb) {
        this.pending.delete(frame[1] as string);
        cb({ at: f.at, payload: frame[0] === 3 ? frame[2] : undefined, error: frame[0] === 4 ? frame : undefined });
      }
    }
    for (const w of [...this.waiters]) {
      if (w.match(f)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(f);
      }
    }
  }

  private issue(callId: string): Record<string, unknown> {
    const transactionId = this.nextTx++;
    this.issuedTx.set(callId, transactionId);
    return { transactionId, idTagInfo: { status: "Accepted" } };
  }

  /** Sends a CSMS->CP call; resolves with the CALLRESULT payload and the instants it was sent/answered. */
  call(action: string, payload: Record<string, unknown>): Promise<{ sentAt: number; answeredAt: number; payload: unknown }> {
    const id = `csms-${++this.seq}`;
    return new Promise((resolveCall, reject) => {
      const sentAt = Date.now();
      this.pending.set(id, (r) => (r.error ? reject(new Error(JSON.stringify(r.error))) : resolveCall({ sentAt, answeredAt: r.at, payload: r.payload })));
      this.ws.send(JSON.stringify([2, id, action, payload]));
    });
  }

  waitFor(match: (f: Frame) => boolean, timeoutMs = 15_000): Promise<Frame> {
    const existing = this.frames.find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolveWait, reject) => {
      const t = setTimeout(() => reject(new Error("timed out waiting for frame")), timeoutMs);
      this.waiters.push({ match, resolve: (f) => (clearTimeout(t), resolveWait(f)) });
    });
  }

  actionsAfter(index: number, action: string): Frame[] {
    return this.frames.slice(index).filter((f) => f.frame[0] === 2 && f.frame[2] === action);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(0.95 * xs.length) - 1)]!;

function registerOf(frame: unknown[]): { at: number; wh: number } | null {
  const payload = frame[3] as { meterValue?: Array<{ timestamp: string; sampledValue: Array<{ measurand?: string; value: string; unit?: string }> }> };
  for (const mv of payload.meterValue ?? []) {
    const sv = mv.sampledValue.find((s) => (s.measurand ?? REGISTER) === REGISTER);
    if (sv) return { at: Date.parse(mv.timestamp), wh: Number(sv.value) };
  }
  return null;
}

/** Register at instant `t`, linearly interpolated between the measured samples (what a watchdog could know). */
function whAt(samples: Array<{ at: number; wh: number }>, t: number): number {
  const s = [...samples].sort((a, b) => a.at - b.at);
  if (t <= s[0]!.at) return s[0]!.wh;
  for (let i = 1; i < s.length; i += 1) {
    if (t <= s[i]!.at) return s[i - 1]!.wh + ((s[i]!.wh - s[i - 1]!.wh) * (t - s[i - 1]!.at)) / (s[i]!.at - s[i - 1]!.at);
  }
  const a = s[s.length - 2]!;
  const b = s[s.length - 1]!;
  return b.wh + ((b.wh - a.wh) * (t - b.at)) / (b.at - a.at); // extrapolate at the latest measured rate
}

describe("CGP commissioning interval configuration", () => {
  it.each([undefined, "1", "4"])("accepts only supported explicit cadence or default: %s", raw => expect(commissioningInterval(raw)).toBe(raw === "4" ? 4 : 1));
  it.each(["", "0", "2", "04", "4.0", " 4", "4 "])("rejects invalid cadence %s", raw => expect(() => commissioningInterval(raw)).toThrow("exactly 1 or 4"));
});

describe("CGP commissioning / overshoot over the OCPP 1.6J wire", () => {
  let server: MockCsmsServer;
  let client: OcppClient;
  let session: OcppChargePointSession;
  let controller: RemoteCommandHandlers;
  let csms: WireCsms;
  const config = new InMemoryConfigurationStore();
  const evidence: Record<string, unknown> = {};

  beforeAll(async () => {
    server = await MockCsmsServer.start();
    client = new OcppClient({ url: server.url, reconnect: { enabled: false } });
    session = new OcppChargePointSession(client, { identity: { chargePointVendor: "EVYAR-EMU", chargePointModel: "cgp-commissioning" }, connectors: [{ connectorId: 1, label: "Plug A" }] });
    session.on("error", () => {});
    controller = registerRemoteCommandHandlers(client, session, { configStore: config, simulatedChargeRateKw: RATE_KW, finishingHoldMs: 0 });
    client.connect();
    csms = new WireCsms(await server.waitForConnection());
    await csms.waitFor((f) => f.frame[2] === "BootNotification");
    await sleep(200);
    await csms.call("ChangeConfiguration", { key: "MeterValueSampleInterval", value: String(METER_INTERVAL_S) });
  }, 30_000);

  afterAll(async () => {
    controller?.dispose();
    session?.dispose();
    client?.disconnect();
    await server?.close();
    if (privateOutputFd !== undefined) {
      try {
        const opened = fstatSync(privateOutputFd), entry = lstatSync(evidenceOut!);
        if (!entry.isFile() || entry.isSymbolicLink() || opened.dev !== entry.dev || opened.ino !== entry.ino || (entry.mode & 0o777) !== 0o600) throw new Error("Calibration output identity changed");
        writeFileSync(privateOutputFd, JSON.stringify(evidence, null, 2) + "\n");
      } finally { closeSync(privateOutputFd); }
    } else if (evidenceOut) {
      const out = resolve(evidenceOut);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(evidence, null, 2) + "\n");
    }
  });

  it("reports the charger-side cache/offline configuration the adapter has to prove (read back over the wire)", async () => {
    const r = await csms.call("GetConfiguration", {});
    const res = r.payload as { configurationKey: Array<{ key: string; value: string; readonly: boolean }> };
    const byKey = Object.fromEntries(res.configurationKey.map((k) => [k.key, k.value]));
    evidence.reportedConfiguration = byKey;
    expect(byKey.MeterValueSampleInterval).toBe(String(METER_INTERVAL_S));
    // The emulator advertises the local auth list profile, so it MUST report whether the list is enabled, and the Core keys.
    expect(byKey.SupportedFeatureProfiles).toContain("LocalAuthListManagement");
    expect(byKey.SupportedFeatureProfiles).not.toContain("AuthorizationCache");
    expect(byKey).toHaveProperty("LocalPreAuthorize");
    expect(byKey).toHaveProperty("AllowOfflineTxForUnknownId");
    expect(byKey).toHaveProperty("LocalAuthListEnabled");
  });

  it("lets the CSMS turn local-list authorization off and reads the change back from the charger", async () => {
    const set = await csms.call("ChangeConfiguration", { key: "LocalAuthListEnabled", value: "false" });
    expect(set.payload).toEqual({ status: "Accepted" });
    const back = await csms.call("GetConfiguration", { key: ["LocalAuthListEnabled", "LocalPreAuthorize", "AllowOfflineTxForUnknownId"] });
    const keys = (back.payload as { configurationKey: Array<{ key: string; value: string }> }).configurationKey;
    expect(Object.fromEntries(keys.map((k) => [k.key, k.value]))).toEqual({ LocalAuthListEnabled: "false", LocalPreAuthorize: "false", AllowOfflineTxForUnknownId: "false" });
    // an unknown key is reported unknown/NotSupported, never silently accepted
    expect((await csms.call("ChangeConfiguration", { key: "SomethingElse", value: "x" })).payload).toEqual({ status: "NotSupported" });
  });

  const trials: Array<{ stopDelayMs: number; overshootWh: number; meterStartWh: number; meterStopWh: number; samples: number; meterValueSamples: number; meterIntervalsMs: number[] }> = [];

  it(`measures stop delay and energy delivered after the stop request (${TRIALS} trials)`, async () => {
    for (let i = 0; i < TRIALS; i += 1) {
      const mark = csms.frames.length;
      await csms.call("RemoteStartTransaction", { connectorId: 1, idTag: `CGP-${i}` });
      const start = await csms.waitFor((f) => f.frame[2] === "StartTransaction" && csms.frames.indexOf(f) >= mark);
      const startPayload = start.frame[3] as { meterStart: number };
      const txId = csms.issuedTx.get(start.frame[1] as string)!;

      await sleep((3_300 + i * 250) * METER_INTERVAL_S); // retain the measured phase and at least three real periodic samples
      const stopMark = csms.frames.length;
      const stop = await csms.call("RemoteStopTransaction", { transactionId: txId });
      expect(stop.payload).toEqual({ status: "Accepted" });
      const stopped = await csms.waitFor((f) => f.frame[2] === "StopTransaction" && csms.frames.indexOf(f) >= stopMark);
      const meterStopWh = (stopped.frame[3] as { meterStop: number }).meterStop;

      const samples = csms.frames.slice(mark).filter((f) => f.frame[2] === "MeterValues").map((f) => registerOf(f.frame)).filter((s): s is { at: number; wh: number } => s !== null);
      const meterValueSamples = samples.length;
      expect(meterValueSamples).toBeGreaterThanOrEqual(3);
      const meterIntervalsMs = samples.slice(1).map((sample, index) => sample.at - samples[index]!.at);
      expect(meterIntervalsMs.every(interval => Number.isFinite(interval) && interval > 0)).toBe(true);
      samples.unshift({ at: start.at, wh: startPayload.meterStart });
      const regAtRequest = whAt(samples, stop.sentAt);
      trials.push({
        stopDelayMs: stopped.at - stop.sentAt,
        overshootWh: Math.max(0, meterStopWh - regAtRequest),
        meterStartWh: startPayload.meterStart,
        meterStopWh,
        samples: samples.length,
        meterValueSamples,
        meterIntervalsMs,
      });
      await sleep(300);
    }
    // physical sanity: the emulator really delivered energy at about the configured rate, and it stopped on request
    for (const t of trials) {
      expect(t.samples).toBeGreaterThanOrEqual(3);
      expect(t.meterStopWh).toBeGreaterThan(t.meterStartWh + 3 * RATE_WH_PER_S * 0.5);
      expect(t.stopDelayMs).toBeLessThan(2_000);
    }
    const overshootWh = Math.ceil(p95(trials.map((t) => t.overshootWh)));
    const stopDelayMs = Math.ceil(p95(trials.map((t) => t.stopDelayMs)));
    evidence.commissioning = {
      subject: "EV charger emulator, OCPP 1.6J wire, registerRemoteCommandHandlers simulation (NOT a physical charger)",
      method: "RemoteStopTransaction sent at an instant between samples; overshoot = StopTransaction.meterStop - register interpolated from the received MeterValues at the request instant",
      rateKw: RATE_KW, meterIntervalSeconds: METER_INTERVAL_S, trials: trials.length, perTrial: trials,
      p95: { overshootWh, stopDelayMs },
      // exactly the body fields of PUT /v1/charging/enforcement-capabilities/:stationMappingId (tenantId/dates/evidenceRef added by the operator)
      capability: { mode: "REACTIVE_MEASURED", overshootWh, stopDelayMs: Math.max(stopDelayMs, 100), meterIntervalSeconds: METER_INTERVAL_S, maxMeterStalenessSeconds: 5 * METER_INTERVAL_S },
    };
    // With this measured sample clock at 20 Wh/s the interpolation error alone is bounded; overshoot must be small and finite.
    expect(overshootWh).toBeLessThan(RATE_WH_PER_S * 2);
  }, 60_000 * METER_INTERVAL_S);

  const adapterLogic = resolve(__dirname, "../../../../../citrineos-adapter/src/charging-enforcement/enforcement.logic.ts");

  it.skipIf(!existsSync(adapterLogic))(
    "the adapter's real decide() keeps a session inside its energy envelope on this wire (bounded path), where an unenforced session would exceed it",
    async () => {
      const logic = (await import(/* @vite-ignore */ adapterLogic)) as typeof import("../../../../../citrineos-adapter/src/charging-enforcement/enforcement.logic");
      const cap = (evidence.commissioning as { capability: { overshootWh: number; stopDelayMs: number; maxMeterStalenessSeconds: number } }).capability;
      const MAX_WH = 300;
      const POLL_MS = 500;
      const mark = csms.frames.length;
      await csms.call("RemoteStartTransaction", { connectorId: 1, idTag: "CGP-ENFORCED" });
      const start = await csms.waitFor((f) => f.frame[2] === "StartTransaction" && csms.frames.indexOf(f) >= mark);
      const meterStart = (start.frame[3] as { meterStart: number }).meterStart;
      const startedAt = new Date(start.at);
      const txId = csms.issuedTx.get(start.frame[1] as string)!;

      // the watchdog: only what the adapter would have (meter rows + server clock), the adapter's own functions
      let lastSampleId: number | null = null;
      let lastSeen: Date | null = null;
      let lastWh: number | null = null;
      let lastRate: number | null = null;
      let stopAt: number | null = null;
      let reason = "";
      const deadline = Date.now() + 40_000;
      while (stopAt === null && Date.now() < deadline) {
        const rows = csms.frames.slice(mark).filter((f) => f.frame[2] === "MeterValues").map((f, i) => {
          const p = f.frame[3] as { meterValue: Array<{ timestamp: string; sampledValue: Array<Record<string, unknown>> }> };
          return { id: i + 1, timestamp: p.meterValue[0]!.timestamp, sampledValue: p.meterValue[0]!.sampledValue.map((s) => ({ ...s, value: Number(s.value) })) };
        });
        const m = logic.latestMeasurement(rows as never);
        const now = new Date();
        if (m && m.sampleId !== lastSampleId) {
          lastSampleId = m.sampleId; lastSeen = now; lastWh = m.wh; lastRate = m.rateWhPerS;
        }
        const view = {
          state: "ACTIVE" as const, maxEnergyWh: MAX_WH, meterStartWh: meterStart, startedAt, effectiveDeadline: logic.effectiveDeadline(new Date(Date.now() + 3_600_000), startedAt, 3_600),
          lastSampleSeenAt: lastSeen, lastMeasuredWh: lastWh, lastRateWhPerS: lastRate, overshootWh: cap.overshootWh, stopDelayMs: cap.stopDelayMs, maxMeterStalenessSeconds: cap.maxMeterStalenessSeconds,
        };
        const d = logic.decide(view, now, POLL_MS);
        if (d.action === "STOP") {
          stopAt = Date.now(); reason = d.reason;
          await csms.call("RemoteStopTransaction", { transactionId: txId });
          break;
        }
        await sleep(POLL_MS);
      }
      expect(stopAt, "the watchdog must have issued a stop").not.toBeNull();
      const stopped = await csms.waitFor((f) => f.frame[2] === "StopTransaction" && f.at >= stopAt!);
      const delivered = (stopped.frame[3] as { meterStop: number }).meterStop - meterStart;
      evidence.enforcedSession = { envelopeWh: MAX_WH, deliveredWh: delivered, stopReason: reason, unenforcedWouldReachWhAt30s: Math.round(RATE_WH_PER_S * 30) };
      // BOUNDED: never over the envelope, and not stopped absurdly early either (the margin is measured, not padded)
      expect(delivered).toBeLessThanOrEqual(MAX_WH);
      expect(delivered).toBeGreaterThan(MAX_WH * 0.5);
      expect(reason).toBe("ENERGY_ENVELOPE");
      // control: left alone this charger would have gone far past the envelope (the bound is real, not vacuous)
      expect(RATE_WH_PER_S * 30).toBeGreaterThan(MAX_WH * 1.5);
    },
    90_000 * METER_INTERVAL_S,
  );

  it("a stale meter (no samples) is detected by the adapter's decide(): the session is stopped even with energy far from the bound", async () => {
    const adapter = adapterLogic;
    if (!existsSync(adapter)) return;
    const logic = (await import(/* @vite-ignore */ adapter)) as typeof import("../../../../../citrineos-adapter/src/charging-enforcement/enforcement.logic");
    const startedAt = new Date(Date.now() - 60_000);
    const d = logic.decide(
      { state: "ACTIVE", maxEnergyWh: 10_000, meterStartWh: 0, startedAt, effectiveDeadline: new Date(Date.now() + 3_600_000), lastSampleSeenAt: new Date(Date.now() - 20_000), lastMeasuredWh: 50, lastRateWhPerS: 0, overshootWh: 20, stopDelayMs: 500, maxMeterStalenessSeconds: 5 },
      new Date(),
      500,
    );
    expect(d).toMatchObject({ action: "STOP", reason: "METER_STALE" });
  });
});
