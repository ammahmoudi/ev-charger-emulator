import {
  ConnectorType,
  OcppProtocolVersion,
  ParameterCategory,
  ParameterValueType,
  PowerType,
  PrismaClient,
} from "@prisma/client";

const prisma = new PrismaClient();

type ParameterSeed = {
  key: string;
  label: string;
  category: ParameterCategory;
  valueType: ParameterValueType;
  unit?: string;
  defaultValue?: string;
  enumOptions?: string[];
  minValue?: number;
  maxValue?: number;
  description?: string;
  sortOrder: number;
};

// Field names and defaults below are taken from the real PEVC3107E's Setting screen tabs
// (Device/System/Networks/Fee Rate/Other) — see docs/device-reference/PEVC3107E. Values shown
// on that captured unit (serials, IPs, prices) are not meaningful and are not reused here.
const pevc3107eParameters: ParameterSeed[] = [
  // --- Device tab (identity / firmware) ---
  {
    key: "firmwareVersion",
    label: "Firmware",
    category: ParameterCategory.DEVICE,
    valueType: ParameterValueType.STRING,
    defaultValue: "403",
    sortOrder: 1,
  },
  {
    key: "uiVersion",
    label: "UI",
    category: ParameterCategory.DEVICE,
    valueType: ParameterValueType.STRING,
    defaultValue: "101",
    sortOrder: 2,
  },
  {
    key: "crc",
    label: "CRC",
    category: ParameterCategory.DEVICE,
    valueType: ParameterValueType.STRING,
    defaultValue: "0xB220",
    sortOrder: 3,
  },
  {
    key: "plugAFirmwareVersion",
    label: "Plug A Firmware",
    category: ParameterCategory.DEVICE,
    valueType: ParameterValueType.STRING,
    defaultValue: "S212",
    sortOrder: 4,
  },
  {
    key: "plugBFirmwareVersion",
    label: "Plug B Firmware",
    category: ParameterCategory.DEVICE,
    valueType: ParameterValueType.STRING,
    defaultValue: "S212",
    sortOrder: 5,
  },

  // --- System tab, page 1 (power/voltage/current limits) ---
  {
    key: "userCode",
    label: "User Code",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.STRING,
    sortOrder: 10,
  },
  {
    key: "powerSupplyQuantity",
    label: "Power supply quantity",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.INTEGER,
    defaultValue: "2",
    minValue: 1,
    sortOrder: 11,
  },
  {
    key: "evChargerRatedPowerKw",
    label: "EV charger rated power",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.FLOAT,
    unit: "kW",
    defaultValue: "60",
    sortOrder: 12,
  },
  {
    key: "maxVoltageOfPowerSupply",
    label: "Maximum voltage of power supply",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.FLOAT,
    unit: "V",
    defaultValue: "1000",
    sortOrder: 13,
  },
  {
    key: "minVoltageOfPowerSupply",
    label: "Minimum voltage of power supply",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.FLOAT,
    unit: "V",
    defaultValue: "150",
    sortOrder: 14,
  },
  {
    key: "maxCurrentOfPowerSupply",
    label: "Maximum current of power supply",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.FLOAT,
    unit: "A",
    defaultValue: "100",
    sortOrder: 15,
  },
  {
    key: "maxCurrentPlugA",
    label: "Maximum current — Plug A",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.FLOAT,
    unit: "A",
    defaultValue: "200",
    sortOrder: 16,
  },
  {
    key: "maxCurrentPlugB",
    label: "Maximum current — Plug B",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.FLOAT,
    unit: "A",
    defaultValue: "200",
    sortOrder: 17,
  },
  {
    key: "fanEnable",
    label: "Fan enable",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.BOOLEAN,
    defaultValue: "false",
    sortOrder: 18,
  },
  {
    key: "plugQuantity",
    label: "Plug quantity",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.ENUM,
    enumOptions: ["Single gun", "Double guns"],
    defaultValue: "Double guns",
    sortOrder: 19,
  },
  {
    key: "powerSupplyType",
    label: "Power supply type",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.STRING,
    defaultValue: "Sino",
    sortOrder: 20,
  },
  {
    key: "timeZone",
    label: "Time zone",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.STRING,
    defaultValue: "UTC+0",
    sortOrder: 21,
  },

  // --- System tab, page 2 (manufacturer, security, sensors) ---
  {
    key: "manufacturerAccess",
    label: "Manufacturer",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.ENUM,
    enumOptions: ["Open", "Closed"],
    defaultValue: "Open",
    sortOrder: 30,
  },
  {
    key: "entranceGuardEnable",
    label: "Entrance guard enable",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.BOOLEAN,
    defaultValue: "true",
    sortOrder: 31,
  },
  {
    key: "adhesionEnable",
    label: "Adhesion enable",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.BOOLEAN,
    defaultValue: "false",
    sortOrder: 32,
  },
  {
    key: "shortCircuitEnable",
    label: "Short circuit enable",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.BOOLEAN,
    defaultValue: "false",
    sortOrder: 33,
  },
  {
    key: "doubleAssistSource",
    label: "Double assist source",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.BOOLEAN,
    defaultValue: "false",
    sortOrder: 34,
  },
  {
    key: "computeLostPercent",
    label: "Compute lost percent",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.FLOAT,
    unit: "%",
    defaultValue: "0",
    minValue: 0,
    maxValue: 100,
    sortOrder: 35,
  },
  {
    key: "devicePassword",
    label: "Device password",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.STRING,
    description: "Local-panel access password. Placeholder default only — rotate per deployment.",
    defaultValue: "4567",
    sortOrder: 36,
  },
  {
    key: "voltageMonitorEnable",
    label: "Voltage monitor",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.BOOLEAN,
    defaultValue: "false",
    sortOrder: 37,
  },
  {
    key: "insulationMonitorEnable",
    label: "Insulation monitor",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.BOOLEAN,
    defaultValue: "true",
    sortOrder: 38,
  },
  {
    key: "plugATempResistorType",
    label: "Plug A temp resistor",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.ENUM,
    enumOptions: ["PT1000", "PT100", "NTC"],
    defaultValue: "PT1000",
    sortOrder: 39,
  },
  {
    key: "plugBTempResistorType",
    label: "Plug B temp resistor",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.ENUM,
    enumOptions: ["PT1000", "PT100", "NTC"],
    defaultValue: "PT1000",
    sortOrder: 40,
  },
  {
    key: "plugAWireType",
    label: "Plug A wire type",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.STRING,
    defaultValue: "CCS2 plug",
    sortOrder: 41,
  },
  {
    key: "plugBWireType",
    label: "Plug B wire type",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.STRING,
    defaultValue: "CCS2 plug",
    sortOrder: 42,
  },
  {
    key: "onlineOperationsEnable",
    label: "Online operations enable",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.BOOLEAN,
    defaultValue: "false",
    sortOrder: 43,
  },

  // --- System tab, page 3 (contactor, distribution, currency) ---
  {
    key: "acContactorEnable",
    label: "AC contactor enable",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.BOOLEAN,
    defaultValue: "true",
    sortOrder: 50,
  },
  {
    key: "powerDistributionLevel",
    label: "Power distribution level",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.ENUM,
    enumOptions: ["Level 1", "Level 2", "Level 3"],
    defaultValue: "Level 2",
    sortOrder: 51,
  },
  {
    key: "overchargeProtectionEnable",
    label: "Overcharge protection enable",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.BOOLEAN,
    defaultValue: "false",
    sortOrder: 52,
  },
  {
    key: "autoCharge",
    label: "Auto charge",
    category: ParameterCategory.SYSTEM,
    valueType: ParameterValueType.BOOLEAN,
    defaultValue: "false",
    sortOrder: 53,
  },

  // --- Networks tab ---
  {
    key: "connectionType",
    label: "Connection type",
    category: ParameterCategory.NETWORKS,
    valueType: ParameterValueType.ENUM,
    enumOptions: ["GPRS", "DHCP", "Ethernet"],
    defaultValue: "Ethernet",
    sortOrder: 60,
  },
  {
    key: "defaultGateway",
    label: "Default gateway",
    category: ParameterCategory.NETWORKS,
    valueType: ParameterValueType.STRING,
    sortOrder: 61,
  },
  {
    key: "localIp",
    label: "Local IP",
    category: ParameterCategory.NETWORKS,
    valueType: ParameterValueType.STRING,
    sortOrder: 62,
  },
  {
    key: "serviceIp",
    label: "Service IP",
    category: ParameterCategory.NETWORKS,
    valueType: ParameterValueType.STRING,
    sortOrder: 63,
  },
  {
    key: "servicePort",
    label: "Service port",
    category: ParameterCategory.NETWORKS,
    valueType: ParameterValueType.INTEGER,
    defaultValue: "80",
    sortOrder: 64,
  },
  {
    key: "domainName",
    label: "Domain name",
    category: ParameterCategory.NETWORKS,
    valueType: ParameterValueType.STRING,
    description: "Holds the full OCPP WebSocket URL, e.g. ws://<csms-host>/ocpp/<chargePointId>.",
    sortOrder: 65,
  },
  {
    key: "backgroundEnable",
    label: "Background enable",
    category: ParameterCategory.NETWORKS,
    valueType: ParameterValueType.ENUM,
    enumOptions: ["Start", "Stop"],
    defaultValue: "Start",
    sortOrder: 66,
  },

  // --- Fee Rate tab ---
  {
    key: "pricePerKwh",
    label: "Charge price",
    category: ParameterCategory.FEE_RATE,
    valueType: ParameterValueType.FLOAT,
    unit: "currency/kWh",
    defaultValue: "1",
    minValue: 0,
    sortOrder: 70,
  },
  {
    key: "currencyUnit",
    label: "Currency unit",
    category: ParameterCategory.FEE_RATE,
    valueType: ParameterValueType.STRING,
    defaultValue: "EUR",
    sortOrder: 71,
  },
  {
    key: "serviceFeePerSession",
    label: "Service fee per session",
    category: ParameterCategory.FEE_RATE,
    valueType: ParameterValueType.FLOAT,
    unit: "currency",
    defaultValue: "0",
    minValue: 0,
    sortOrder: 72,
  },
  {
    key: "timeOfUseEnable",
    label: "Time-of-use pricing enable",
    category: ParameterCategory.FEE_RATE,
    valueType: ParameterValueType.BOOLEAN,
    defaultValue: "false",
    sortOrder: 73,
  },

  // --- Other tab, page 1 (input/output over-voltage & over-current protection) ---
  {
    key: "inputOvervoltageEnable",
    label: "Input overvoltage enable",
    category: ParameterCategory.OTHER,
    valueType: ParameterValueType.BOOLEAN,
    defaultValue: "true",
    sortOrder: 80,
  },
  {
    key: "inputOvervoltageConstantV",
    label: "Input overvoltage constant value",
    category: ParameterCategory.OTHER,
    valueType: ParameterValueType.FLOAT,
    unit: "V",
    defaultValue: "437",
    sortOrder: 81,
  },
  {
    key: "inputOvervoltageTimeS",
    label: "Input overvoltage time",
    category: ParameterCategory.OTHER,
    valueType: ParameterValueType.FLOAT,
    unit: "s",
    defaultValue: "2",
    sortOrder: 82,
  },
  {
    key: "inputUndervoltageEnable",
    label: "Input undervoltage enable",
    category: ParameterCategory.OTHER,
    valueType: ParameterValueType.BOOLEAN,
    defaultValue: "true",
    sortOrder: 83,
  },
  {
    key: "inputUndervoltageConstantV",
    label: "Input undervoltage constant value",
    category: ParameterCategory.OTHER,
    valueType: ParameterValueType.FLOAT,
    unit: "V",
    defaultValue: "323",
    sortOrder: 84,
  },
  {
    key: "inputUndervoltageTimeS",
    label: "Input undervoltage time",
    category: ParameterCategory.OTHER,
    valueType: ParameterValueType.FLOAT,
    unit: "s",
    defaultValue: "2",
    sortOrder: 85,
  },
  {
    key: "outputOvervoltageEnable",
    label: "Output overvoltage enable",
    category: ParameterCategory.OTHER,
    valueType: ParameterValueType.BOOLEAN,
    defaultValue: "false",
    sortOrder: 86,
  },
  {
    key: "outputOvervoltageConstantV",
    label: "Output overvoltage constant value",
    category: ParameterCategory.OTHER,
    valueType: ParameterValueType.FLOAT,
    unit: "V",
    defaultValue: "800",
    sortOrder: 87,
  },
  {
    key: "outputOvervoltageTimeS",
    label: "Output overvoltage time",
    category: ParameterCategory.OTHER,
    valueType: ParameterValueType.FLOAT,
    unit: "s",
    defaultValue: "0",
    sortOrder: 88,
  },
  {
    key: "outputOvercurrentEnable",
    label: "Output overcurrent enable",
    category: ParameterCategory.OTHER,
    valueType: ParameterValueType.BOOLEAN,
    defaultValue: "false",
    sortOrder: 89,
  },
  {
    key: "outputOvercurrentConstantA",
    label: "Output overcurrent constant value",
    category: ParameterCategory.OTHER,
    valueType: ParameterValueType.FLOAT,
    unit: "A",
    defaultValue: "200",
    sortOrder: 90,
  },
  {
    key: "outputOvercurrentTimeS",
    label: "Output overcurrent time",
    category: ParameterCategory.OTHER,
    valueType: ParameterValueType.FLOAT,
    unit: "s",
    defaultValue: "0",
    sortOrder: 91,
  },

  // --- Other tab, page 2 (temperature protection) ---
  {
    key: "pileTemperatureProtectionEnable",
    label: "Pile temperature protection enable",
    category: ParameterCategory.OTHER,
    valueType: ParameterValueType.BOOLEAN,
    defaultValue: "false",
    sortOrder: 100,
  },
  {
    key: "pileTemperatureProtectionConstantC",
    label: "Pile temperature protection constant value",
    category: ParameterCategory.OTHER,
    valueType: ParameterValueType.FLOAT,
    unit: "degC",
    defaultValue: "80",
    sortOrder: 101,
  },
  {
    key: "pileTemperatureProtectionTimeS",
    label: "Pile temperature protection time",
    category: ParameterCategory.OTHER,
    valueType: ParameterValueType.FLOAT,
    unit: "s",
    defaultValue: "2",
    sortOrder: 102,
  },
  {
    key: "plugTemperatureProtectionEnable",
    label: "Plug temperature protection enable",
    category: ParameterCategory.OTHER,
    valueType: ParameterValueType.BOOLEAN,
    defaultValue: "true",
    sortOrder: 103,
  },
  {
    key: "plugTemperatureProtectionConstantC",
    label: "Plug temperature protection constant value",
    category: ParameterCategory.OTHER,
    valueType: ParameterValueType.FLOAT,
    unit: "degC",
    defaultValue: "90",
    sortOrder: 104,
  },
  {
    key: "plugTemperatureProtectionTimeS",
    label: "Plug temperature protection time",
    category: ParameterCategory.OTHER,
    valueType: ParameterValueType.FLOAT,
    unit: "s",
    defaultValue: "0",
    sortOrder: 105,
  },
  // --- Other tab, page 3 (QR codes) --- two CSMS-configurable URLs (readable/writable via
  // GetConfiguration/ChangeConfiguration like any other key) that the QR overlay screen
  // (`/instances/[id]/qr`) renders as scannable QR codes when set.
  {
    key: "qrCodeUrl1",
    label: "QR code URL 1",
    category: ParameterCategory.OTHER,
    valueType: ParameterValueType.STRING,
    defaultValue: "",
    sortOrder: 106,
  },
  {
    key: "qrCodeUrl2",
    label: "QR code URL 2",
    category: ParameterCategory.OTHER,
    valueType: ParameterValueType.STRING,
    defaultValue: "",
    sortOrder: 107,
  },
];

// Charge point identity for the out-of-the-box sample instance created below, so a fresh
// clone has something to click into immediately (issue #7).
const SAMPLE_INSTANCE_CHARGE_POINT_ID = "DEMO-PEVC3107E-01";

async function seedPevc3107e() {
  const deviceModel = await prisma.deviceModel.upsert({
    where: { manufacturer_model: { manufacturer: "PEVC", model: "PEVC3107E" } },
    update: {
      brand: "SINO",
      ocppProtocol: OcppProtocolVersion.OCPP_1_6,
      description:
        "Dual-gun (Plug A / Plug B) DC fast charger, CCS2 connectors, OCPP 1.6J.",
    },
    create: {
      manufacturer: "PEVC",
      brand: "SINO",
      model: "PEVC3107E",
      ocppProtocol: OcppProtocolVersion.OCPP_1_6,
      description:
        "Dual-gun (Plug A / Plug B) DC fast charger, CCS2 connectors, OCPP 1.6J.",
    },
  });

  const connectors = [
    { evseIndex: 1, connectorIndex: 1, label: "Plug A" },
    { evseIndex: 2, connectorIndex: 1, label: "Plug B" },
  ];

  for (const connector of connectors) {
    await prisma.deviceModelConnector.upsert({
      where: {
        deviceModelId_evseIndex_connectorIndex: {
          deviceModelId: deviceModel.id,
          evseIndex: connector.evseIndex,
          connectorIndex: connector.connectorIndex,
        },
      },
      update: {
        label: connector.label,
        connectorType: ConnectorType.CCS2,
        powerType: PowerType.DC,
        maxAmperage: 200,
        maxVoltage: 1000,
        maxPowerKw: 60,
      },
      create: {
        deviceModelId: deviceModel.id,
        evseIndex: connector.evseIndex,
        connectorIndex: connector.connectorIndex,
        label: connector.label,
        connectorType: ConnectorType.CCS2,
        powerType: PowerType.DC,
        maxAmperage: 200,
        maxVoltage: 1000,
        maxPowerKw: 60,
      },
    });
  }

  for (const parameter of pevc3107eParameters) {
    await prisma.deviceModelParameter.upsert({
      where: {
        deviceModelId_key: {
          deviceModelId: deviceModel.id,
          key: parameter.key,
        },
      },
      update: {
        label: parameter.label,
        category: parameter.category,
        valueType: parameter.valueType,
        unit: parameter.unit,
        defaultValue: parameter.defaultValue,
        enumOptions: parameter.enumOptions ?? [],
        minValue: parameter.minValue,
        maxValue: parameter.maxValue,
        description: parameter.description,
        sortOrder: parameter.sortOrder,
      },
      create: {
        deviceModelId: deviceModel.id,
        key: parameter.key,
        label: parameter.label,
        category: parameter.category,
        valueType: parameter.valueType,
        unit: parameter.unit,
        defaultValue: parameter.defaultValue,
        enumOptions: parameter.enumOptions ?? [],
        minValue: parameter.minValue,
        maxValue: parameter.maxValue,
        description: parameter.description,
        sortOrder: parameter.sortOrder,
      },
    });
  }

  console.log(
    `Seeded device model ${deviceModel.manufacturer} ${deviceModel.model} with ${connectors.length} connectors and ${pevc3107eParameters.length} parameters.`,
  );

  return deviceModel.id;
}

/**
 * Creates one ready-to-go DeviceInstance from the PEVC3107E model so a fresh clone has
 * something to click into immediately (issue #7), instead of only the DeviceModel catalog
 * entry seeded above. Its CSMS URL is a local placeholder — edit it from the instance's
 * Networks tab to point at a real CSMS dev/staging endpoint before connecting.
 *
 * Skips creation if an instance with this chargePointId already exists, so re-running the
 * seed never clobbers a demo instance you've since edited (e.g. pointed at a real CSMS).
 */
async function seedSampleInstance(deviceModelId: string) {
  const existing = await prisma.deviceInstance.findUnique({
    where: { chargePointId: SAMPLE_INSTANCE_CHARGE_POINT_ID },
  });
  if (existing) {
    console.log(`Sample device instance "${SAMPLE_INSTANCE_CHARGE_POINT_ID}" already exists, leaving it as-is.`);
    return;
  }

  const parameters = await prisma.deviceModelParameter.findMany({ where: { deviceModelId } });

  const instance = await prisma.deviceInstance.create({
    data: {
      deviceModelId,
      name: "Demo PEVC3107E",
      chargePointId: SAMPLE_INSTANCE_CHARGE_POINT_ID,
      csmsUrl: `ws://localhost:9000/${SAMPLE_INSTANCE_CHARGE_POINT_ID}`,
      masterCardIdTag: "MASTER0001",
      parameters: {
        create: parameters.map((parameter) => ({
          deviceModelParameterId: parameter.id,
          key: parameter.key,
          value: parameter.defaultValue,
        })),
      },
    },
  });

  console.log(
    `Seeded sample device instance "${instance.name}" (chargePointId=${instance.chargePointId}, ` +
      `csmsUrl=${instance.csmsUrl}). Edit its CSMS URL from the Networks tab before connecting to a real CSMS.`,
  );
}

async function main() {
  const deviceModelId = await seedPevc3107e();
  await seedSampleInstance(deviceModelId);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
