import {
  startChargingSession,
  type ConnectorRuntimeView,
} from "@/lib/device-instances/connector-sessions";
import { lookupLocalAuthEntry } from "@/lib/device-instances/local-auth";
import { callOcpp, getRuntimeConnectionState } from "@/lib/device-instances/runtime";
import { prisma } from "@/lib/prisma";

export class RfidError extends Error {}

/** Authorizes a card locally or online, then joins the shared EV/start handshake. */
export async function presentRfidCard(
  deviceInstanceId: string,
  connectorId: number,
  idTag: string,
  chargeRateKw: number,
): Promise<ConnectorRuntimeView> {
  const instance = await prisma.deviceInstance.findUniqueOrThrow({
    where: { id: deviceInstanceId },
    select: { masterCardIdTag: true },
  });

  if (instance.masterCardIdTag && idTag === instance.masterCardIdTag) {
    return startChargingSession(deviceInstanceId, connectorId, { idTag, chargeRateKw });
  }

  const localEntry = await lookupLocalAuthEntry(deviceInstanceId, idTag);
  if (localEntry) {
    return startChargingSession(deviceInstanceId, connectorId, { idTag, chargeRateKw });
  }

  if (getRuntimeConnectionState(deviceInstanceId) !== "connected") {
    throw new RfidError(
      "This card isn't the master card or in the local authorization list, and the instance isn't connected to a CSMS to authorize it — start the instance's OCPP connection first, add the card to the local list, or present the master card.",
    );
  }

  const authResponse = await callOcpp(deviceInstanceId, "Authorize", { idTag });
  const authStatus = (authResponse.idTagInfo as { status?: string } | undefined)?.status;
  if (authStatus !== "Accepted") {
    throw new RfidError(`Card rejected by CSMS (${authStatus ?? "no response"})`);
  }

  return startChargingSession(deviceInstanceId, connectorId, { idTag, chargeRateKw });
}
