/**
 * Headless RFID session over the emulator's REAL OCPP 1.6J protocol engine (no Next.js, no database).
 *
 * Connects to a real CSMS (CitrineOS Core) as a charge point and performs exactly what the emulator's RFID path does
 * on the wire: BootNotification -> StatusNotification -> (plug in) Preparing -> Authorize(idTag) -> StartTransaction ->
 * periodic MeterValues from a cumulative Wh register at the configured rate -> StopTransaction when stopped. A
 * RemoteStopTransaction from the CSMS side (the adapter's watchdog) stops it for real. Nothing here pretends a result:
 * every frame is recorded with a local timestamp and written to the evidence file.
 *
 * Env: OCPP_URL (ws://host:8081/<stationId>), ID_TAG, CONNECTOR_ID=1, CHARGE_RATE_KW=22, METER_INTERVAL_S=2,
 *      MAX_SECONDS=300, STOP_AFTER_S (optional local stop), EVIDENCE_OUT.
 * Exit: 0 session reached Charging and ended (by remote stop, local stop or max time); 1 error; 3 start refused by the CSMS.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { InMemoryConfigurationStore, OcppChargePointSession, OcppClient, registerRemoteCommandHandlers } from "../src/lib/ocpp";

const url = process.env.OCPP_URL;
const idTag = process.env.ID_TAG;
if (!url || !idTag) { console.error("NOT RUN: OCPP_URL and ID_TAG are required"); process.exit(1); }
const connectorId = Number(process.env.CONNECTOR_ID ?? 1);
const rateKw = Number(process.env.CHARGE_RATE_KW ?? 22);
const maxSeconds = Number(process.env.MAX_SECONDS ?? 300);
const stopAfterS = process.env.STOP_AFTER_S ? Number(process.env.STOP_AFTER_S) : null;
const REGISTER = "Energy.Active.Import.Register";

interface Frame { at: string; dir: "->CSMS" | "<-CSMS"; action: string; payload: unknown }
const frames: Frame[] = [];
const log = (dir: Frame["dir"], action: string, payload: unknown) => frames.push({ at: new Date().toISOString(), dir, action, payload });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const config = new InMemoryConfigurationStore();
const client = new OcppClient({ url, reconnect: { enabled: false } });

// Record every request this charge point sends and every CSMS call it answers.
const rawCall = client.call.bind(client);
(client as unknown as { call: typeof client.call }).call = (async (action: string, payload: Record<string, unknown>) => {
  log("->CSMS", action, payload);
  const response = await rawCall(action, payload);
  log("<-CSMS", `${action}.conf`, response);
  return response;
}) as typeof client.call;
const rawRegister = client.registerHandler.bind(client);
(client as unknown as { registerHandler: typeof client.registerHandler }).registerHandler = ((action: string, handler: (p: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>) =>
  rawRegister(action, async (p: Record<string, unknown>) => {
    log("<-CSMS", action, p);
    const result = await handler(p);
    log("->CSMS", `${action}.conf`, result);
    return result;
  })) as typeof client.registerHandler;

const session = new OcppChargePointSession(client, { identity: { chargePointVendor: "EVYAR-EMU", chargePointModel: "cgp-headless" }, connectors: [{ connectorId, label: "Plug A" }] });
session.on("error", () => {});
const controller = registerRemoteCommandHandlers(client, session, { configStore: config, simulatedChargeRateKw: rateKw, finishingHoldMs: 0 });

let registerWh = 0;
let tx: { transactionId: number; startedAt: number; meterStart: number } | null = null;
let meterTimer: NodeJS.Timeout | null = null;
let ended: { reason: string; at: number } | null = null;
let lastTick = 0;

const sample = () => {
  const now = Date.now();
  registerWh += (rateKw * 1000 / 3600) * ((now - lastTick) / 1000);
  lastTick = now;
  return Math.round(registerWh);
};
const sampledValue = (wh: number, context: string) => [{ value: String(wh), context, measurand: REGISTER, unit: "Wh", location: "Outlet" }];

async function finish(reason: "Remote" | "Local" | "EVDisconnected") {
  if (!tx || ended) return;
  if (meterTimer) clearInterval(meterTimer);
  const meterStop = sample();
  const closing = tx;
  ended = { reason, at: Date.now() };
  session.setConnectorStatus(connectorId, "Finishing");
  await rawCall("StopTransaction", { transactionId: closing.transactionId, idTag, meterStop, timestamp: new Date().toISOString(), reason, transactionData: [{ timestamp: new Date().toISOString(), sampledValue: sampledValue(meterStop, "Transaction.End") }] })
    .then((r) => log("<-CSMS", "StopTransaction.conf", r))
    .catch((e) => log("<-CSMS", "StopTransaction.error", String(e)));
  log("->CSMS", "StopTransaction", { transactionId: closing.transactionId, meterStop, reason });
  session.setConnectorStatus(connectorId, "Available");
}

// A CSMS-side stop (the adapter watchdog's RemoteStop) of the swipe-started transaction.
rawRegister("RemoteStopTransaction", async (p: Record<string, unknown>) => {
  log("<-CSMS", "RemoteStopTransaction", p);
  if (tx && Number(p.transactionId) === tx.transactionId && !ended) {
    log("->CSMS", "RemoteStopTransaction.conf", { status: "Accepted" });
    setImmediate(() => void finish("Remote"));
    return { status: "Accepted" };
  }
  log("->CSMS", "RemoteStopTransaction.conf", { status: "Rejected" });
  return { status: "Rejected" };
});

let exitCode = 0;
let outcome = "INCOMPLETE";
async function main() {
  client.connect();
  const connectedAt = Date.now();
  while (session.getBootStatus() !== "accepted" && Date.now() - connectedAt < 30_000) await sleep(200);
  if (session.getBootStatus() !== "accepted") throw new Error(`BootNotification not accepted (status ${session.getBootStatus()})`);
  await sleep(500);

  session.setConnectorStatus(connectorId, "Preparing"); // EV plugged in
  await sleep(500);
  // Optional idle phase: stay connected (answering GetConfiguration/ChangeConfiguration like a real charger) until the scenario
  // has finished commissioning, then swipe when the trigger file appears.
  const trigger = process.env.SWIPE_TRIGGER_FILE;
  console.log(JSON.stringify({ event: "READY", connected: true, trigger: trigger ?? null }));
  if (trigger) {
    const waitUntil = Date.now() + Number(process.env.IDLE_MAX_SECONDS ?? 600) * 1000;
    while (!existsSync(trigger) && Date.now() < waitUntil) await sleep(250);
    if (!existsSync(trigger)) { outcome = "IDLE_TIMEOUT"; exitCode = 3; return; }
  }
  const auth = (await client.call("Authorize", { idTag })) as { idTagInfo?: { status?: string } };
  if (auth.idTagInfo?.status !== "Accepted") { outcome = `AUTHORIZE_${auth.idTagInfo?.status ?? "NO_ANSWER"}`; exitCode = 3; session.setConnectorStatus(connectorId, "Available"); return; }

  lastTick = Date.now();
  const meterStart = Math.round(registerWh);
  const start = (await client.call("StartTransaction", { connectorId, idTag, meterStart, timestamp: new Date().toISOString() })) as { transactionId?: number; idTagInfo?: { status?: string } };
  if (start.idTagInfo?.status !== "Accepted" || typeof start.transactionId !== "number") { outcome = `START_${start.idTagInfo?.status ?? "NO_ANSWER"}`; exitCode = 3; session.setConnectorStatus(connectorId, "Available"); return; }
  tx = { transactionId: start.transactionId, startedAt: Date.now(), meterStart };
  session.setConnectorStatus(connectorId, "Charging");

  const cfg = await config.list(["MeterValueSampleInterval"]);
  // An explicit METER_INTERVAL_S wins (scenario control); otherwise the charge point's own configured sample interval applies.
  const configured = Number(cfg.known[0]?.value);
  const intervalS = process.env.METER_INTERVAL_S ? Number(process.env.METER_INTERVAL_S) : configured > 0 ? configured : 5;
  meterTimer = setInterval(() => {
    if (!tx || ended) return;
    const wh = sample();
    void client.call("MeterValues", { connectorId, transactionId: tx.transactionId, meterValue: [{ timestamp: new Date().toISOString(), sampledValue: sampledValue(wh, "Sample.Periodic") }] }).catch(() => {});
  }, intervalS * 1000);

  const deadline = Date.now() + maxSeconds * 1000;
  while (!ended && Date.now() < deadline) {
    if (stopAfterS !== null && Date.now() - tx.startedAt >= stopAfterS * 1000) await finish("Local");
    await sleep(250);
  }
  if (!ended) await finish("Local");
  await sleep(1500);
  outcome = `ENDED_${ended!.reason.toUpperCase()}`;
}

main().catch((e) => { outcome = `ERROR: ${e instanceof Error ? e.message : String(e)}`; exitCode = 1; }).finally(async () => {
  controller.dispose();
  session.dispose();
  client.disconnect();
  const meterValues = frames.filter((f) => f.action === "MeterValues" && f.dir === "->CSMS");
  const evidence = {
    subject: "EV charger emulator protocol engine, headless (no Next.js); OCPP 1.6J over a real WebSocket to a real CSMS; NOT a physical charger",
    url: url.replace(/\/\/[^/@]*@/, "//"), idTagHash: idTag.length, connectorId, rateKw, outcome,
    transaction: tx ? { ...tx, endedBy: ended?.reason ?? null, deliveredWh: ended ? Math.round(registerWh) - tx.meterStart : null } : null,
    meterSamples: meterValues.length, frames,
  };
  if (process.env.EVIDENCE_OUT) {
    const out = resolve(process.env.EVIDENCE_OUT);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(evidence, null, 2) + "\n");
  }
  console.log(JSON.stringify({ outcome, transactionId: tx?.transactionId ?? null, deliveredWh: evidence.transaction?.deliveredWh ?? null, endedBy: ended?.reason ?? null, meterSamples: meterValues.length }));
  process.exit(exitCode);
});
