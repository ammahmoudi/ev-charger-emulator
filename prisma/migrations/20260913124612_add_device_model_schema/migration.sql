-- CreateEnum
CREATE TYPE "OcppProtocolVersion" AS ENUM ('OCPP_1_6', 'OCPP_2_0_1');

-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('CCS1', 'CCS2', 'CHADEMO', 'TYPE_1', 'TYPE_2', 'GBT_AC', 'GBT_DC', 'TESLA', 'OTHER');

-- CreateEnum
CREATE TYPE "PowerType" AS ENUM ('AC', 'DC');

-- CreateEnum
CREATE TYPE "ParameterCategory" AS ENUM ('DEVICE', 'SYSTEM', 'NETWORKS', 'FEE_RATE', 'OTHER');

-- CreateEnum
CREATE TYPE "ParameterValueType" AS ENUM ('STRING', 'INTEGER', 'FLOAT', 'BOOLEAN', 'ENUM');

-- CreateTable
CREATE TABLE "DeviceModel" (
    "id" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT NOT NULL,
    "ocppProtocol" "OcppProtocolVersion" NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceModelConnector" (
    "id" TEXT NOT NULL,
    "deviceModelId" TEXT NOT NULL,
    "evseIndex" INTEGER NOT NULL,
    "connectorIndex" INTEGER NOT NULL,
    "label" TEXT,
    "connectorType" "ConnectorType" NOT NULL,
    "powerType" "PowerType" NOT NULL,
    "maxAmperage" DOUBLE PRECISION,
    "maxVoltage" DOUBLE PRECISION,
    "maxPowerKw" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceModelConnector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceModelParameter" (
    "id" TEXT NOT NULL,
    "deviceModelId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" "ParameterCategory" NOT NULL,
    "valueType" "ParameterValueType" NOT NULL,
    "unit" TEXT,
    "defaultValue" TEXT,
    "enumOptions" TEXT[],
    "minValue" DOUBLE PRECISION,
    "maxValue" DOUBLE PRECISION,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceModelParameter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceModel_manufacturer_model_key" ON "DeviceModel"("manufacturer", "model");

-- CreateIndex
CREATE INDEX "DeviceModelConnector_deviceModelId_idx" ON "DeviceModelConnector"("deviceModelId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceModelConnector_deviceModelId_evseIndex_connectorIndex_key" ON "DeviceModelConnector"("deviceModelId", "evseIndex", "connectorIndex");

-- CreateIndex
CREATE INDEX "DeviceModelParameter_deviceModelId_idx" ON "DeviceModelParameter"("deviceModelId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceModelParameter_deviceModelId_key_key" ON "DeviceModelParameter"("deviceModelId", "key");

-- AddForeignKey
ALTER TABLE "DeviceModelConnector" ADD CONSTRAINT "DeviceModelConnector_deviceModelId_fkey" FOREIGN KEY ("deviceModelId") REFERENCES "DeviceModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceModelParameter" ADD CONSTRAINT "DeviceModelParameter_deviceModelId_fkey" FOREIGN KEY ("deviceModelId") REFERENCES "DeviceModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
