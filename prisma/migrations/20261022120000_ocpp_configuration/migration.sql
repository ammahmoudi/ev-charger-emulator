CREATE TABLE "DeviceInstanceOcppConfiguration" (
  "deviceInstanceId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeviceInstanceOcppConfiguration_pkey" PRIMARY KEY ("deviceInstanceId", "key"),
  CONSTRAINT "DeviceInstanceOcppConfiguration_deviceInstanceId_fkey" FOREIGN KEY ("deviceInstanceId") REFERENCES "DeviceInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "DeviceInstanceConnectorState" ADD COLUMN "activeStartPending" BOOLEAN NOT NULL DEFAULT false;
