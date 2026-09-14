-- AlterTable
ALTER TABLE "DeviceInstance" ADD COLUMN     "masterCardIdTag" TEXT;

-- AlterTable
ALTER TABLE "DeviceInstanceConnectorState" ADD COLUMN     "activeIsRemote" BOOLEAN NOT NULL DEFAULT false;
