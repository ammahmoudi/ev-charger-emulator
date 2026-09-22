import { afterEach, describe, expect, it } from "vitest";

import { bumpFirmwareVersion, FIRMWARE_UPGRADE_DURATION_MS, getMaintenanceState, startFirmwareUpgrade } from "../maintenance";
import { createTestModelAndInstance, deleteTestDeviceModel, type TestDeviceModel } from "./test-helpers";
import { prisma } from "@/lib/prisma";

describe("bumpFirmwareVersion", () => {
  it("increments the trailing numeric segment", () => {
    expect(bumpFirmwareVersion("1.0.0")).toBe("1.0.1");
    expect(bumpFirmwareVersion("1.0.9")).toBe("1.0.10");
    expect(bumpFirmwareVersion("2.3")).toBe("2.4");
  });

  it("appends .1 when the version has no trailing numeric segment", () => {
    expect(bumpFirmwareVersion("v-alpha")).toBe("v-alpha.1");
  });
});

describe.skipIf(!process.env.DATABASE_URL)("firmware upgrade persistence (integration)", () => {
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

  it(
    "marks connectors Unavailable immediately, then Available with a bumped firmware version once the upgrade completes",
    async () => {
      await setup();
      const started = await startFirmwareUpgrade(instanceId);
      expect(started.connectors.every((c) => c.status === "Unavailable")).toBe(true);

      const instanceDuringUpgrade = await prisma.deviceInstance.findUniqueOrThrow({ where: { id: instanceId } });
      expect(instanceDuringUpgrade.firmwareUpgradeStartedAt).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, FIRMWARE_UPGRADE_DURATION_MS + 200));

      const finished = await getMaintenanceState(instanceId);
      expect(finished.connectors.every((c) => c.status === "Available")).toBe(true);
      expect(finished.firmwareVersion).toBe("1.0.1");

      const instanceAfterUpgrade = await prisma.deviceInstance.findUniqueOrThrow({ where: { id: instanceId } });
      expect(instanceAfterUpgrade.firmwareUpgradeStartedAt).toBeNull();
    },
    FIRMWARE_UPGRADE_DURATION_MS + 2000,
  );

  it("self-heals a stale in-flight upgrade left by a process restart (no in-memory timer, but the duration has elapsed)", async () => {
    await setup();
    // Simulate what a persisted-but-abandoned in-flight upgrade looks like after a restart:
    // firmwareUpgradeStartedAt is set (in the past, well beyond the upgrade duration) and
    // connectors are Unavailable, but nothing in *this* process's upgradeTimers map owns it.
    await prisma.deviceInstance.update({
      where: { id: instanceId },
      data: { firmwareUpgradeStartedAt: new Date(Date.now() - FIRMWARE_UPGRADE_DURATION_MS - 10_000) },
    });
    await prisma.deviceInstanceConnectorState.createMany({
      data: [1, 2].map((connectorId) => ({ deviceInstanceId: instanceId, connectorId, status: "Unavailable" })),
    });

    const state = await getMaintenanceState(instanceId);
    expect(state.connectors.every((c) => c.status === "Available")).toBe(true);
    expect(state.firmwareVersion).toBe("1.0.1");

    const instance = await prisma.deviceInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(instance.firmwareUpgradeStartedAt).toBeNull();
  });
});
