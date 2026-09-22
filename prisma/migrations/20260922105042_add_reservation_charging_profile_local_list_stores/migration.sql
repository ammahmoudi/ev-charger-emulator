-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LocalAuthEntryStatus" ADD VALUE 'INVALID';
ALTER TYPE "LocalAuthEntryStatus" ADD VALUE 'CONCURRENT_TX';

-- AlterTable
ALTER TABLE "DeviceInstance" ADD COLUMN     "localAuthListVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "DeviceInstanceLocalAuthEntry" ADD COLUMN     "parentIdTag" TEXT;

-- CreateTable
CREATE TABLE "DeviceInstanceReservation" (
    "id" TEXT NOT NULL,
    "deviceInstanceId" TEXT NOT NULL,
    "reservationId" INTEGER NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "idTag" TEXT NOT NULL,
    "parentIdTag" TEXT,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceInstanceReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceInstanceChargingProfile" (
    "id" TEXT NOT NULL,
    "deviceInstanceId" TEXT NOT NULL,
    "chargingProfileId" INTEGER NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "profile" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceInstanceChargingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceInstanceReservation_deviceInstanceId_idx" ON "DeviceInstanceReservation"("deviceInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceInstanceReservation_deviceInstanceId_reservationId_key" ON "DeviceInstanceReservation"("deviceInstanceId", "reservationId");

-- CreateIndex
CREATE INDEX "DeviceInstanceChargingProfile_deviceInstanceId_idx" ON "DeviceInstanceChargingProfile"("deviceInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceInstanceChargingProfile_deviceInstanceId_chargingProf_key" ON "DeviceInstanceChargingProfile"("deviceInstanceId", "chargingProfileId");

-- AddForeignKey
ALTER TABLE "DeviceInstanceReservation" ADD CONSTRAINT "DeviceInstanceReservation_deviceInstanceId_fkey" FOREIGN KEY ("deviceInstanceId") REFERENCES "DeviceInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceInstanceChargingProfile" ADD CONSTRAINT "DeviceInstanceChargingProfile_deviceInstanceId_fkey" FOREIGN KEY ("deviceInstanceId") REFERENCES "DeviceInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
