import { OcppCallError } from "./errors";
import type { OcppDataTransferHandler, OcppDataTransferStatus } from "./remote-command-types";

/**
 * Builds the `DataTransfer` handler: this emulator implements no vendor-specific extensions, so
 * every `vendorId` is `UnknownVendorId` by default — the spec-correct response for an
 * unrecognized vendor namespace — unless a caller supplies a handler for it via
 * `RemoteCommandHandlersDeps.dataTransferHandlers`.
 */
export function createDataTransferHandler(
  handlers: Record<string, OcppDataTransferHandler> = {},
): (payload: Record<string, unknown>) => Promise<{ status: OcppDataTransferStatus; data?: string }> {
  return async function handleDataTransfer(payload: Record<string, unknown>) {
    const { vendorId, messageId, data } = payload;
    if (typeof vendorId !== "string" || vendorId.length === 0) {
      throw new OcppCallError("PropertyConstraintViolation", "vendorId is required");
    }

    const handler = handlers[vendorId];
    if (!handler) {
      return { status: "UnknownVendorId" as const };
    }
    return handler(typeof messageId === "string" ? messageId : undefined, typeof data === "string" ? data : undefined);
  };
}
