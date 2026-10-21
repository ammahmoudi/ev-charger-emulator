ALTER TABLE "DeviceInstanceConnectorState" ADD COLUMN "preparingSince" TIMESTAMP(3);
UPDATE "DeviceInstanceConnectorState" SET "preparingSince" = CURRENT_TIMESTAMP WHERE "status" = 'Preparing';
