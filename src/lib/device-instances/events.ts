import type { DeviceInstanceEventType } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Appends one row to a device instance's Event log (issue #14's Event screen). Fire-and-forget
 * from callers that shouldn't fail their own operation if logging does — errors are swallowed
 * after being reported to the console, matching how other best-effort side effects in this
 * codebase (e.g. runtime.ts's stub timer) are handled.
 */
export async function logDeviceInstanceEvent(
  deviceInstanceId: string,
  type: DeviceInstanceEventType,
  description: string,
  occurredAt: Date = new Date(),
): Promise<void> {
  try {
    await prisma.deviceInstanceEvent.create({
      data: { deviceInstanceId, type, description, occurredAt },
    });
  } catch (err) {
    console.error(`Failed to log device instance event (${type}) for ${deviceInstanceId}:`, err);
  }
}
