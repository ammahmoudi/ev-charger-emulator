import { afterEach, describe, expect, it } from "vitest";

import {
  adoptRemoteSession,
  ConnectorSessionError,
  listConnectorStates,
  startChargingSession,
  stopChargingSession,
} from "../connector-sessions";
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
});
