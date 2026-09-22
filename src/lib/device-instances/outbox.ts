import { Prisma, type OutboxAction } from "@prisma/client";

import { logDeviceInstanceEvent } from "@/lib/device-instances/events";
import { prisma } from "@/lib/prisma";

/**
 * A device instance's offline OCPP outbox (see `prisma/schema.prisma`'s
 * `DeviceInstanceOutboxMessage`) — the "local storage" transaction queue the brief calls for:
 * an OCPP call that should have reached the CSMS but couldn't (disconnected, or the call itself
 * failed) is queued here instead of silently dropped, and replayed in order once the instance
 * reconnects (see `runtime.ts`'s `bootAccepted` handler, which calls `drainOutbox`).
 */

export interface QueuedOutboxMessage {
  id: string;
  action: OutboxAction;
  payload: Record<string, unknown>;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

/** Queues an OCPP call for later delivery, exactly as it would be sent via `callOcpp(deviceInstanceId, action, payload)`. */
export async function queueOutboxMessage(
  deviceInstanceId: string,
  action: OutboxAction,
  payload: Record<string, unknown>,
): Promise<void> {
  await prisma.deviceInstanceOutboxMessage.create({
    data: { deviceInstanceId, action, payload: payload as Prisma.InputJsonValue },
  });
  await logDeviceInstanceEvent(deviceInstanceId, "REMOTE_COMMAND", `Queued ${action} for delivery once the CSMS connection is restored`);
}

/** Lists every message still queued for an instance, oldest first (delivery order). */
export async function listOutboxMessages(deviceInstanceId: string): Promise<QueuedOutboxMessage[]> {
  const messages = await prisma.deviceInstanceOutboxMessage.findMany({
    where: { deviceInstanceId },
    orderBy: { createdAt: "asc" },
  });
  return messages.map((m) => ({
    id: m.id,
    action: m.action,
    payload: m.payload as Record<string, unknown>,
    attempts: m.attempts,
    lastError: m.lastError,
    createdAt: m.createdAt.toISOString(),
  }));
}

/**
 * Replays every queued message for an instance, in order, via `sender` (the caller's `callOcpp`
 * — passed in rather than imported directly to avoid a `runtime.ts` <-> `outbox.ts` import
 * cycle, since `runtime.ts` is both where `callOcpp` lives and where draining is triggered from).
 * Stops at the first failure (rather than skipping ahead) so delivery order is preserved: the
 * next reconnect's drain will retry from the same message. Returns how many messages were
 * successfully delivered.
 */
export async function drainOutbox(
  deviceInstanceId: string,
  sender: (action: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>,
): Promise<number> {
  const pending = await listOutboxMessages(deviceInstanceId);
  let delivered = 0;

  for (const message of pending) {
    try {
      await sender(message.action, message.payload);
      await prisma.deviceInstanceOutboxMessage.delete({ where: { id: message.id } });
      await logDeviceInstanceEvent(deviceInstanceId, "REMOTE_COMMAND", `Delivered queued ${message.action} to CSMS`);
      delivered += 1;
    } catch (err) {
      await prisma.deviceInstanceOutboxMessage.update({
        where: { id: message.id },
        data: { attempts: { increment: 1 }, lastError: err instanceof Error ? err.message : String(err) },
      });
      break;
    }
  }

  return delivered;
}
