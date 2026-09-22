-- AlterTable
ALTER TABLE "DeviceInstance" ADD COLUMN     "diagnosticsInstanceState" JSONB,
ADD COLUMN     "hardwareTestInstanceState" JSONB;

-- CreateTable
CREATE TABLE "DeviceInstanceConnectorDiagnosticState" (
    "id" TEXT NOT NULL,
    "deviceInstanceId" TEXT NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "diagnosticsToggles" JSONB,
    "hardwareTestToggles" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceInstanceConnectorDiagnosticState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceInstanceConnectorDiagnosticState_deviceInstanceId_con_key" ON "DeviceInstanceConnectorDiagnosticState"("deviceInstanceId", "connectorId");

-- AddForeignKey
ALTER TABLE "DeviceInstanceConnectorDiagnosticState" ADD CONSTRAINT "DeviceInstanceConnectorDiagnosticState_deviceInstanceId_fkey" FOREIGN KEY ("deviceInstanceId") REFERENCES "DeviceInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
