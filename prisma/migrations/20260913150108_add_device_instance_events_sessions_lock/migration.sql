-- CreateEnum
CREATE TYPE "DeviceInstanceEventType" AS ENUM ('CONNECTED', 'DISCONNECTED', 'BOOT', 'STATUS_CHANGE', 'TRANSACTION_STARTED', 'TRANSACTION_STOPPED', 'FAULT', 'REMOTE_COMMAND');

-- CreateTable
CREATE TABLE "DeviceInstanceEvent" (
    "id" TEXT NOT NULL,
    "deviceInstanceId" TEXT NOT NULL,
    "type" "DeviceInstanceEventType" NOT NULL,
    "description" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceInstanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceInstanceSession" (
    "id" TEXT NOT NULL,
    "deviceInstanceId" TEXT NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "connectorLabel" TEXT,
    "idTag" TEXT NOT NULL,
    "transactionId" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "stoppedAt" TIMESTAMP(3) NOT NULL,
    "energyWh" DOUBLE PRECISION NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "currency" TEXT,
    "stopCause" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceInstanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceInstanceConnectorState" (
    "id" TEXT NOT NULL,
    "deviceInstanceId" TEXT NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Available',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "activeIdTag" TEXT,
    "activeTransactionId" INTEGER,
    "activeStartedAt" TIMESTAMP(3),
    "activeChargeRateKw" DOUBLE PRECISION,
    "transactionCounter" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceInstanceConnectorState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceInstanceEvent_deviceInstanceId_occurredAt_idx" ON "DeviceInstanceEvent"("deviceInstanceId", "occurredAt");

-- CreateIndex
CREATE INDEX "DeviceInstanceSession_deviceInstanceId_startedAt_idx" ON "DeviceInstanceSession"("deviceInstanceId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceInstanceConnectorState_deviceInstanceId_connectorId_key" ON "DeviceInstanceConnectorState"("deviceInstanceId", "connectorId");

-- AddForeignKey
ALTER TABLE "DeviceInstanceEvent" ADD CONSTRAINT "DeviceInstanceEvent_deviceInstanceId_fkey" FOREIGN KEY ("deviceInstanceId") REFERENCES "DeviceInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceInstanceSession" ADD CONSTRAINT "DeviceInstanceSession_deviceInstanceId_fkey" FOREIGN KEY ("deviceInstanceId") REFERENCES "DeviceInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceInstanceConnectorState" ADD CONSTRAINT "DeviceInstanceConnectorState_deviceInstanceId_fkey" FOREIGN KEY ("deviceInstanceId") REFERENCES "DeviceInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
