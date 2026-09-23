import { prisma } from "@/lib/prisma";

/**
 * Shared fixtures for the integration-style tests in this directory that exercise real
 * persistence (see AUDIT-state.md: these modules are almost entirely persistence logic, so
 * mocking Prisma would test very little). Each test creates its own `DeviceModel`/`DeviceInstance`
 * pair with a unique key and tears it down in `afterAll`/`afterEach`, so tests can run against a
 * shared local Postgres (`docker-compose.yml`, `DATABASE_URL` from `.env`) without colliding.
 */

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createTestDeviceModel(connectorCount = 2) {
  return prisma.deviceModel.create({
    data: {
      manufacturer: "TESTMFR",
      brand: "TESTBRAND",
      model: `TEST-${uniqueSuffix()}`,
      ocppProtocol: "OCPP_1_6",
      connectors: {
        create: Array.from({ length: connectorCount }, (_, i) => ({
          evseIndex: i + 1,
          connectorIndex: 1,
          label: `Plug ${String.fromCharCode(65 + i)}`,
          connectorType: "CCS2",
          powerType: "DC",
        })),
      },
      parameters: {
        create: [
          { key: "pricePerKwh", label: "Price per kWh", category: "FEE_RATE", valueType: "FLOAT", defaultValue: "0.35" },
          { key: "currencyUnit", label: "Currency", category: "FEE_RATE", valueType: "STRING", defaultValue: "USD" },
          {
            key: "serviceFeePerSession",
            label: "Service fee per session",
            category: "FEE_RATE",
            valueType: "FLOAT",
            defaultValue: "0",
          },
          { key: "firmwareVersion", label: "Firmware version", category: "DEVICE", valueType: "STRING", defaultValue: "1.0.0" },
        ],
      },
    },
    include: { connectors: true, parameters: true },
  });
}

export type TestDeviceModel = Awaited<ReturnType<typeof createTestDeviceModel>>;

export async function createTestInstance(
  deviceModel: TestDeviceModel,
  overrides: { masterCardIdTag?: string | null; csmsUrl?: string } = {},
) {
  return prisma.deviceInstance.create({
    data: {
      deviceModelId: deviceModel.id,
      name: "Test instance",
      chargePointId: `test-${uniqueSuffix()}`,
      csmsUrl: overrides.csmsUrl ?? "ws://localhost:1/unused",
      masterCardIdTag: overrides.masterCardIdTag === undefined ? "MASTER-TEST" : overrides.masterCardIdTag,
      parameters: {
        create: deviceModel.parameters.map((p) => ({ deviceModelParameterId: p.id, key: p.key, value: p.defaultValue })),
      },
    },
  });
}

/** Creates a device model + instance pair in one call, for tests that don't need to customize the model. */
export async function createTestModelAndInstance(overrides: { masterCardIdTag?: string | null; csmsUrl?: string } = {}) {
  const deviceModel = await createTestDeviceModel();
  const instance = await createTestInstance(deviceModel, overrides);
  return { deviceModel, instance };
}

export async function deleteTestDeviceModel(deviceModelId: string): Promise<void> {
  await prisma.deviceInstance.deleteMany({ where: { deviceModelId } });
  await prisma.deviceModel.delete({ where: { id: deviceModelId } }).catch(() => {});
}
