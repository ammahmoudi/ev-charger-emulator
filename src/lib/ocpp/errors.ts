import type { OcppErrorCode } from "./types";

/** Raised when a CALL is rejected by the remote end with a CALLERROR frame. */
export class OcppCallError extends Error {
  constructor(
    public readonly errorCode: OcppErrorCode,
    public readonly errorDescription: string,
    public readonly errorDetails: Record<string, unknown> = {},
  ) {
    super(`${errorCode}: ${errorDescription}`);
    this.name = "OcppCallError";
  }
}

/** Raised when a CALL is not answered within its timeout window. */
export class OcppTimeoutError extends Error {
  constructor(action: string, messageId: string) {
    super(`Timed out waiting for a response to ${action} (${messageId})`);
    this.name = "OcppTimeoutError";
  }
}

/** Raised when a CALL is still pending when the connection drops. */
export class OcppConnectionClosedError extends Error {
  constructor(action: string, messageId: string) {
    super(`Connection closed while awaiting a response to ${action} (${messageId})`);
    this.name = "OcppConnectionClosedError";
  }
}
