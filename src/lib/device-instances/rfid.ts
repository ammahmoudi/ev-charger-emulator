import { adoptRemoteSession, startChargingSession, type ConnectorRuntimeView } from "@/lib/device-instances/connector-sessions";
import { lookupLocalAuthEntry } from "@/lib/device-instances/local-auth";
import { callOcpp, getOrCreateChargePointSession, getRuntimeConnectionState } from "@/lib/device-instances/runtime";
import { prisma } from "@/lib/prisma";

export class RfidError extends Error {}

/**
 * Presents an RFID card to a connector, mirroring the real device's card-reader flow. Three paths:
 *
 * - The instance's **master card** (`DeviceInstance.masterCardIdTag`) always works locally,
 *   regardless of CSMS connection — delegates straight to `startChargingSession`'s existing
 *   Preparing→Charging local simulation, unchanged from before this feature existed.
 * - An idTag present (and `ACCEPTED`, unexpired) in the instance's **local authorization
 *   list/cache** (`local-auth.ts`) also authorizes locally, the same way a real charger's
 *   `SendLocalList`-populated table or cached `Authorize` response lets it authorize a known
 *   card without a live CSMS round-trip — including while offline.
 * - Any other idTag requires the instance to be `CONNECTED` and sends a real client-initiated
 *   `Authorize` then `StartTransaction` over the live OCPP connection — a genuine charge-point
 *   card swipe, distinct from the CSMS-initiated `RemoteStartTransaction` handler. On success,
 *   the result is adopted into the same local connector state (`adoptRemoteSession`) so the Home
 *   screen's existing timer/Stop UI displays it identically to a local session.
 */
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

  const session = await getOrCreateChargePointSession(deviceInstanceId);
  const info = session.getConnectorStatus(connectorId);
  if (!info || info.status !== "Available") {
    throw new RfidError(`Connector ${connectorId} is not Available (status: ${info?.status ?? "unknown"})`);
  }

  const authResponse = await callOcpp(deviceInstanceId, "Authorize", { idTag });
  const authStatus = (authResponse.idTagInfo as { status?: string } | undefined)?.status;
  if (authStatus !== "Accepted") {
    throw new RfidError(`Card rejected by CSMS (${authStatus ?? "no response"})`);
  }

  session.setConnectorStatus(connectorId, "Preparing");
  let transactionId: number;
  try {
    const startResponse = await callOcpp(deviceInstanceId, "StartTransaction", {
      connectorId,
      idTag,
      meterStart: 0,
      timestamp: new Date().toISOString(),
    });
    const startStatus = (startResponse.idTagInfo as { status?: string } | undefined)?.status;
    if (startStatus && startStatus !== "Accepted") {
      throw new RfidError(`StartTransaction rejected by CSMS (${startStatus})`);
    }
    transactionId = Number(startResponse.transactionId);
  } catch (err) {
    session.setConnectorStatus(connectorId, "Available");
    if (err instanceof RfidError) throw err;
    throw new RfidError(err instanceof Error ? err.message : String(err));
  }

  session.setConnectorStatus(connectorId, "Charging");
  return adoptRemoteSession(deviceInstanceId, connectorId, { idTag, transactionId, chargeRateKw });
}
