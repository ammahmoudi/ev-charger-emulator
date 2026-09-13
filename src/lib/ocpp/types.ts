/**
 * OCPP-J message framing types, per the OCPP 1.6J WebSocket sub-protocol spec.
 */

export const OcppMessageTypeId = {
  CALL: 2,
  CALLRESULT: 3,
  CALLERROR: 4,
} as const;

export type OcppCallMessage = [
  typeof OcppMessageTypeId.CALL,
  string,
  string,
  Record<string, unknown>,
];

export type OcppCallResultMessage = [
  typeof OcppMessageTypeId.CALLRESULT,
  string,
  Record<string, unknown>,
];

export type OcppCallErrorMessage = [
  typeof OcppMessageTypeId.CALLERROR,
  string,
  OcppErrorCode,
  string,
  Record<string, unknown>,
];

export type OcppMessage =
  | OcppCallMessage
  | OcppCallResultMessage
  | OcppCallErrorMessage;

/** Error codes defined by the OCPP-J spec (spelling, incl. "Occurence", matches the spec text). */
export type OcppErrorCode =
  | "NotImplemented"
  | "NotSupported"
  | "InternalError"
  | "ProtocolError"
  | "SecurityError"
  | "FormationViolation"
  | "PropertyConstraintViolation"
  | "OccurenceConstraintViolation"
  | "TypeConstraintViolation"
  | "GenericError";

export interface OcppHandlerContext {
  action: string;
  messageId: string;
}

/** A handler for an incoming CALL for a given action, registered by higher-level feature modules. */
export type OcppActionHandler<
  TPayload = Record<string, unknown>,
  TResult = Record<string, unknown>,
> = (payload: TPayload, context: OcppHandlerContext) => TResult | Promise<TResult>;

export type OcppConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "closing";

export interface OcppDisconnectInfo {
  code: number;
  reason: string;
  /** Whether disconnect() was called explicitly, as opposed to an unexpected drop. */
  wasClean: boolean;
}

export interface OcppReconnectOptions {
  /** Whether to automatically reconnect after an unexpected disconnect. Default: true. */
  enabled?: boolean;
  /** Delay before the first reconnect attempt, in ms. Default: 1000. */
  initialDelayMs?: number;
  /** Upper bound for the backoff delay, in ms. Default: 30000. */
  maxDelayMs?: number;
  /** Multiplier applied to the delay after each failed attempt. Default: 2. */
  factor?: number;
  /** Maximum number of reconnect attempts. Default: Infinity. */
  maxRetries?: number;
}

export interface OcppClientOptions {
  /** CSMS WebSocket URL, e.g. ws://localhost:9000/CP1. */
  url: string;
  /** WebSocket sub-protocol to negotiate. Default: 'ocpp1.6'. */
  subprotocol?: string;
  /** Default timeout for outgoing CALLs awaiting a CALLRESULT/CALLERROR, in ms. Default: 30000. */
  callTimeoutMs?: number;
  reconnect?: OcppReconnectOptions;
}

export type OcppClientEvents = {
  connecting: [attempt: number];
  connected: [];
  disconnected: [info: OcppDisconnectInfo];
  error: [error: Error];
};
