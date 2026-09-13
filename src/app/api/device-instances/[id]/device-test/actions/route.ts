import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { badRequest, notFound } from "@/lib/device-instances/http";
import {
  setAuxPowerAction,
  setContactorAction,
  setLockAction,
  setPileContactorAction,
  startChargingTest,
  stopChargingTest,
} from "@/lib/device-instances/hardware-test-state";
import type {
  AuxPowerAction,
  ContactorAction,
  HardwareTestState,
  LockAction,
  PileContactorTarget,
} from "@/lib/device-instances/hardware-test-types";

const CONTACTOR_ACTIONS: ContactorAction[] = ["start", "stop"];
const AUX_POWER_ACTIONS: AuxPowerAction[] = ["12V", "24V", "stop"];
const LOCK_ACTIONS: LockAction[] = ["start", "stop"];
const PILE_TARGETS: PileContactorTarget[] = ["threePhaseAcContactor", "powerContactor", "fanContactor", "breaker"];

interface ActionBody {
  kind?: unknown;
  connectorId?: unknown;
  target?: unknown;
  action?: unknown;
}

function requireConnectorId(body: ActionBody): number | Response {
  if (typeof body.connectorId !== "number") {
    return badRequest("connectorId is required and must be a number", "connectorId");
  }
  return body.connectorId;
}

/**
 * Applies one manual test action from the "Device" hardware test screen (issue #16).
 * Each action flips real, shared state — see `hardware-test-state.ts` for how it composes
 * with the OCPP connector-status session (#8/#10) and the local charging simulation (#9).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: ActionBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON");
  }

  try {
    let state: HardwareTestState;

    switch (body.kind) {
      case "chargingTest": {
        const connectorId = requireConnectorId(body);
        if (connectorId instanceof Response) return connectorId;
        if (body.action !== "start" && body.action !== "stop") {
          return badRequest("action must be 'start' or 'stop'", "action");
        }
        state = body.action === "start" ? await startChargingTest(id, connectorId) : await stopChargingTest(id, connectorId);
        break;
      }

      case "contactor": {
        const connectorId = requireConnectorId(body);
        if (connectorId instanceof Response) return connectorId;
        if (!CONTACTOR_ACTIONS.includes(body.action as ContactorAction)) {
          return badRequest(`action must be one of: ${CONTACTOR_ACTIONS.join(", ")}`, "action");
        }
        state = await setContactorAction(id, connectorId, body.action as ContactorAction);
        break;
      }

      case "auxPower": {
        const connectorId = requireConnectorId(body);
        if (connectorId instanceof Response) return connectorId;
        if (!AUX_POWER_ACTIONS.includes(body.action as AuxPowerAction)) {
          return badRequest(`action must be one of: ${AUX_POWER_ACTIONS.join(", ")}`, "action");
        }
        state = await setAuxPowerAction(id, connectorId, body.action as AuxPowerAction);
        break;
      }

      case "lock": {
        const connectorId = requireConnectorId(body);
        if (connectorId instanceof Response) return connectorId;
        if (!LOCK_ACTIONS.includes(body.action as LockAction)) {
          return badRequest(`action must be one of: ${LOCK_ACTIONS.join(", ")}`, "action");
        }
        state = await setLockAction(id, connectorId, body.action as LockAction);
        break;
      }

      case "pileContactor": {
        if (!PILE_TARGETS.includes(body.target as PileContactorTarget)) {
          return badRequest(`target must be one of: ${PILE_TARGETS.join(", ")}`, "target");
        }
        if (!CONTACTOR_ACTIONS.includes(body.action as ContactorAction)) {
          return badRequest(`action must be one of: ${CONTACTOR_ACTIONS.join(", ")}`, "action");
        }
        state = await setPileContactorAction(id, body.target as PileContactorTarget, body.action as ContactorAction);
        break;
      }

      default:
        return badRequest("kind must be one of: chargingTest, contactor, auxPower, lock, pileContactor", "kind");
    }

    return NextResponse.json({ state });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return notFound("Device instance not found");
    }
    if (err instanceof Error && err.message.startsWith("Unknown connectorId")) {
      return badRequest(err.message, "connectorId");
    }
    throw err;
  }
}
