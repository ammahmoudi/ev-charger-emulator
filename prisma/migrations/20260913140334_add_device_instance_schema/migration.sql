-- CreateEnum
CREATE TYPE "DeviceConnectionStatus" AS ENUM ('DISCONNECTED', 'CONNECTING', 'CONNECTED', 'FAULTED');

-- CreateTable
CREATE TABLE "DeviceInstance" (
    "id" TEXT NOT NULL,
    "deviceModelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chargePointId" TEXT NOT NULL,
    "csmsUrl" TEXT NOT NULL,
    "status" "DeviceConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "statusReason" TEXT,
    "lastConnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceInstanceParameter" (
    "id" TEXT NOT NULL,
    "deviceInstanceId" TEXT NOT NULL,
    "deviceModelParameterId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceInstanceParameter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceInstance_chargePointId_key" ON "DeviceInstance"("chargePointId");

-- CreateIndex
CREATE INDEX "DeviceInstance_deviceModelId_idx" ON "DeviceInstance"("deviceModelId");

-- CreateIndex
CREATE INDEX "DeviceInstanceParameter_deviceInstanceId_idx" ON "DeviceInstanceParameter"("deviceInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceInstanceParameter_deviceInstanceId_deviceModelParamet_key" ON "DeviceInstanceParameter"("deviceInstanceId", "deviceModelParameterId");

-- AddForeignKey
ALTER TABLE "DeviceInstance" ADD CONSTRAINT "DeviceInstance_deviceModelId_fkey" FOREIGN KEY ("deviceModelId") REFERENCES "DeviceModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceInstanceParameter" ADD CONSTRAINT "DeviceInstanceParameter_deviceInstanceId_fkey" FOREIGN KEY ("deviceInstanceId") REFERENCES "DeviceInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceInstanceParameter" ADD CONSTRAINT "DeviceInstanceParameter_deviceModelParameterId_fkey" FOREIGN KEY ("deviceModelParameterId") REFERENCES "DeviceModelParameter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
