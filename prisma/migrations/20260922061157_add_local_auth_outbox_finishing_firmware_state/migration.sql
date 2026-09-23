-- CreateEnum
CREATE TYPE "LocalAuthEntryStatus" AS ENUM ('ACCEPTED', 'BLOCKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OutboxAction" AS ENUM ('StartTransaction', 'StopTransaction', 'MeterValues');

-- AlterTable
ALTER TABLE "DeviceInstance" ADD COLUMN     "firmwareUpgradeStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DeviceInstanceConnectorState" ADD COLUMN     "finishingNextStatus" TEXT,
ADD COLUMN     "finishingSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DeviceInstanceLocalAuthEntry" (
    "id" TEXT NOT NULL,
    "deviceInstanceId" TEXT NOT NULL,
    "idTag" TEXT NOT NULL,
    "status" "LocalAuthEntryStatus" NOT NULL DEFAULT 'ACCEPTED',
    "cacheExpiryDateTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceInstanceLocalAuthEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceInstanceOutboxMessage" (
    "id" TEXT NOT NULL,
    "deviceInstanceId" TEXT NOT NULL,
    "action" "OutboxAction" NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceInstanceOutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceInstanceLocalAuthEntry_deviceInstanceId_idx" ON "DeviceInstanceLocalAuthEntry"("deviceInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceInstanceLocalAuthEntry_deviceInstanceId_idTag_key" ON "DeviceInstanceLocalAuthEntry"("deviceInstanceId", "idTag");

-- CreateIndex
CREATE INDEX "DeviceInstanceOutboxMessage_deviceInstanceId_createdAt_idx" ON "DeviceInstanceOutboxMessage"("deviceInstanceId", "createdAt");

-- AddForeignKey
ALTER TABLE "DeviceInstanceLocalAuthEntry" ADD CONSTRAINT "DeviceInstanceLocalAuthEntry_deviceInstanceId_fkey" FOREIGN KEY ("deviceInstanceId") REFERENCES "DeviceInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceInstanceOutboxMessage" ADD CONSTRAINT "DeviceInstanceOutboxMessage_deviceInstanceId_fkey" FOREIGN KEY ("deviceInstanceId") REFERENCES "DeviceInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
