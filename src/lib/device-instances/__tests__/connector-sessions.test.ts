import { afterEach, describe, expect, it } from "vitest";

import {
  adoptRemoteSession,
  ConnectorSessionError,
  listConnectorStates,
  startChargingSession,
  stopChargingSession,
} from "../connector-sessions";
import { orderModelConnectors } from "../connectors";
import { startChargingTest, stopChargingTest } from "../hardware-test-state";
import { getInstanceConnectorStatuses } from "../runtime";
import { createTestModelAndInstance, deleteTestDeviceModel, type TestDeviceModel } from "./test-helpers";
import { prisma } from "@/lib/prisma";

describe.skipIf(!process.env.DATABASE_URL)("connector-sessions (integration)", () => {
  let deviceModel: TestDeviceModel;
  let instanceId: string;

  afterEach(async () => {
    if (deviceModel) await deleteTestDeviceModel(deviceModel.id);
  });

  async function setup() {
    const created = await createTestModelAndInstance();
    deviceModel = created.deviceModel;
    instanceId = created.instance.id;
  }

  it("starts a local session in Preparing and mirrors it onto the OCPP session", async () => {
    await setup();
    const view = await startChargingSession(instanceId, 1, { idTag: "CARD-1", chargeRateKw: 20 });
    expect(view.status).toBe("Preparing");
    expect(view.locked).toBe(true);

    const live = getInstanceConnectorStatuses(instanceId).find((c) => c.connectorId === 1);
    expect(live?.status).toBe("Preparing");
  });

  it("rejects a non-positive chargeRateKw", async () => {
    await setup();
    await expect(startChargingSession(instanceId, 1, { idTag: "CARD-1", chargeRateKw: 0 })).rejects.toThrow(ConnectorSessionError);
  });

  it("promotes Preparing to Charging once the preparing duration has elapsed, and mirrors it onto the OCPP session", async () => {
    await setup();
    await startChargingSession(instanceId, 1, { idTag: "CARD-1", chargeRateKw: 20 });

    // Backdate instead of waiting out PREPARING_DURATION_MS for real.
    await prisma.deviceInstanceConnectorState.update({
      where: { deviceInstanceId_connectorId: { deviceInstanceId: instanceId, connectorId: 1 } },
      data: { activeStartedAt: new Date(Date.now() - 20_000) },
    });

    const states = await listConnectorStates(instanceId);
    const connector1 = states.find((c) => c.connectorId === 1)!;
    expect(connector1.status).toBe("Charging");
    expect(connector1.activeSession?.transactionId).toBe(1);

    const live = getInstanceConnectorStatuses(instanceId).find((c) => c.connectorId === 1);
    expect(live?.status).toBe("Charging");
  });

  it("stopping a Charging session enters Finishing, then settles to Available once its hold elapses", async () => {
    await setup();
    await startChargingSession(instanceId, 1, { idTag: "CARD-1", chargeRateKw: 20 });
    await prisma.deviceInstanceConnectorState.update({
      where: { deviceInstanceId_connectorId: { deviceInstanceId: instanceId, connectorId: 1 } },
      data: { activeStartedAt: new Date(Date.now() - 20_000) },
    });
    await listConnectorStates(instanceId); // resolves the Preparing->Charging promotion

    const result = await stopChargingSession(instanceId, 1, { stopCause: "Manu. Stop" });
    expect(result.transactionId).toBe(1);

    let states = await listConnectorStates(instanceId);
    expect(states.find((c) => c.connectorId === 1)?.status).toBe("Finishing");
    expect(getInstanceConnectorStatuses(instanceId).find((c) => c.connectorId === 1)?.status).toBe("Finishing");

    await prisma.deviceInstanceConnectorState.update({
      where: { deviceInstanceId_connectorId: { deviceInstanceId: instanceId, connectorId: 1 } },
      data: { finishingSince: new Date(Date.now() - 10_000) },
    });

    states = await listConnectorStates(instanceId);
    expect(states.find((c) => c.connectorId === 1)?.status).toBe("Available");
    expect(getInstanceConnectorStatuses(instanceId).find((c) => c.connectorId === 1)?.status).toBe("Available");
  });

  it("stopping during Preparing (no transaction minted yet) skips Finishing and goes straight to Available", async () => {
    await setup();
    await startChargingSession(instanceId, 1, { idTag: "CARD-1", chargeRateKw: 20 });

    const result = await stopChargingSession(instanceId, 1, { stopCause: "EV Disconnected" });
    expect(result.transactionId).toBeNull();
    expect(result.energyKwh).toBe(0);

    const states = await listConnectorStates(instanceId);
    expect(states.find((c) => c.connectorId === 1)?.status).toBe("Available");
  });

  it("a fault stop cause goes straight to Faulted, skipping Finishing", async () => {
    await setup();
    await startChargingSession(instanceId, 1, { idTag: "CARD-1", chargeRateKw: 20 });
    await prisma.deviceInstanceConnectorState.update({
      where: { deviceInstanceId_connectorId: { deviceInstanceId: instanceId, connectorId: 1 } },
      data: { activeStartedAt: new Date(Date.now() - 20_000) },
    });
    await listConnectorStates(instanceId);

    const result = await stopChargingSession(instanceId, 1, { stopCause: "QF Err" });
    expect(result.isFault).toBe(true);

    const states = await listConnectorStates(instanceId);
    expect(states.find((c) => c.connectorId === 1)?.status).toBe("Faulted");
  });

  it("queues a StopTransaction to the outbox when the CSMS call fails for a remote (activeIsRemote) session", async () => {
    await setup();
    await adoptRemoteSession(instanceId, 1, { idTag: "CARD-9", transactionId: 42, chargeRateKw: 10 });

    await stopChargingSession(instanceId, 1, { stopCause: "Remote Stop" });

    const queued = await prisma.deviceInstanceOutboxMessage.findMany({ where: { deviceInstanceId: instanceId } });
    expect(queued).toHaveLength(1);
    expect(queued[0].action).toBe("StopTransaction");
    expect((queued[0].payload as Record<string, unknown>).transactionId).toBe(42);
  });

  // `skipCsmsNotify`/`energyWhOverride` back `src/lib/ocpp/remote-commands.ts`'s
  // `onRemoteTransactionStopped` hook (see AUDIT-integration.md and `runtime.ts`): that module
  // already sent the real `StopTransaction` to the CSMS itself before mirroring the stop here,
  // so this function must not send a second one, and should record the same energy figure the
  // CSMS actually saw rather than re-deriving its own from elapsed time.
  it("skipCsmsNotify avoids queuing a second StopTransaction, and energyWhOverride is recorded as-is", async () => {
    await setup();
    await adoptRemoteSession(instanceId, 1, { idTag: "CARD-9", transactionId: 43, chargeRateKw: 10 });

    const result = await stopChargingSession(instanceId, 1, {
      stopCause: "Remote Stop",
      skipCsmsNotify: true,
      energyWhOverride: 1234,
    });

    expect(result.energyKwh).toBeCloseTo(1.234, 3);
    const queued = await prisma.deviceInstanceOutboxMessage.findMany({ where: { deviceInstanceId: instanceId } });
    expect(queued).toHaveLength(0);
  });

  // Two-way collision guard with hardware-test-state.ts (AUDIT-state.md round-2 addendum): a
  // hardware output test and a real/local charging session must not run concurrently on the same
  // connector. The other direction (hardware-test-state.ts refusing to start on top of an active
  // session) is covered in hardware-test-state.test.ts.
  it("startChargingSession refuses to start on a connector running a hardware output test", async () => {
    await setup();
    await startChargingTest(instanceId, 1);

    await expect(startChargingSession(instanceId, 1, { idTag: "CARD-1", chargeRateKw: 20 })).rejects.toThrow(
      /hardware output test/,
    );

    await stopChargingTest(instanceId, 1);
    const view = await startChargingSession(instanceId, 1, { idTag: "CARD-1", chargeRateKw: 20 });
    expect(view.status).toBe("Preparing");
  });

  it("adoptRemoteSession refuses to start on a connector running a hardware output test", async () => {
    await setup();
    await startChargingTest(instanceId, 1);

    await expect(
      adoptRemoteSession(instanceId, 1, { idTag: "CARD-9", transactionId: 99, chargeRateKw: 10 }),
    ).rejects.toThrow(/hardware output test/);
  });

  // AUDIT-state.md's round-2 addendum: the hot-polled path (startChargingSession/
  // stopChargingSession/setConnectorLock/clearConnectorFault) now fetches the connector topology
  // once and threads it through rather than each independently re-fetching it — listConnectorStates
  // accepts an optional preloaded connectors list for this. Verify passing one produces the exact
  // same result as the default (self-fetching) path.
  it("listConnectorStates with a preloaded connector list matches the default self-fetching path", async () => {
    await setup();
    await startChargingSession(instanceId, 1, { idTag: "CARD-1", chargeRateKw: 20 });

    const instance = await prisma.deviceInstance.findUniqueOrThrow({
      where: { id: instanceId },
      include: { deviceModel: { include: { connectors: true } } },
    });
    const preloaded = orderModelConnectors(instance.deviceModel.connectors);

    const [withPreload, withoutPreload] = await Promise.all([
      listConnectorStates(instanceId, preloaded),
      listConnectorStates(instanceId),
    ]);
    expect(withPreload).toEqual(withoutPreload);
  });
});
