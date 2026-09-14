-- AlterTable
ALTER TABLE "DeviceInstance" ADD COLUMN     "ocppConfigOverrides" JSONB NOT NULL DEFAULT '{}';
