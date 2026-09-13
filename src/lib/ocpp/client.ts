import { randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";

import { OcppCallError, OcppConnectionClosedError, OcppTimeoutError } from "./errors";
import { TypedEventEmitter } from "./typed-event-emitter";
import {
  OcppMessageTypeId,
  type OcppActionHandler,
  type OcppCallErrorMessage,
  type OcppCallMessage,
  type OcppCallResultMessage,
  type OcppClientEvents,
  type OcppClientOptions,
  type OcppConnectionState,
  type OcppErrorCode,
  type OcppReconnectOptions,
} from "./types";

interface PendingCall {
  action: string;
  resolve: (payload: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * OCPP 1.6J WebSocket client engine.
 *
 * Owns the WebSocket connection, subprotocol negotiation, CALL/CALLRESULT/CALLERROR
 * framing, request/response correlation, reconnect/backoff, and a pluggable action
 * handler registry. Feature modules (boot notification, heartbeat, transactions,
 * remote commands, ...) register handlers via `registerHandler` and send requests via
 * `call` — none of them need to touch framing, correlation, or socket lifecycle.
 */
export class OcppClient extends TypedEventEmitter<OcppClientEvents> {
  private readonly url: string;
  private readonly subprotocol: string;
  private readonly callTimeoutMs: number;
  private readonly reconnectOptions: Required<OcppReconnectOptions>;

  private ws: WebSocket | null = null;
  private state: OcppConnectionState = "disconnected";
  private manualClose = true;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingCalls = new Map<string, PendingCall>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly handlers = new Map<string, OcppActionHandler<any, any>>();

  constructor(options: OcppClientOptions) {
    super();
    this.url = options.url;
    this.subprotocol = options.subprotocol ?? "ocpp1.6";
    this.callTimeoutMs = options.callTimeoutMs ?? 30_000;
    this.reconnectOptions = {
      enabled: options.reconnect?.enabled ?? true,
      initialDelayMs: options.reconnect?.initialDelayMs ?? 1_000,
      maxDelayMs: options.reconnect?.maxDelayMs ?? 30_000,
      factor: options.reconnect?.factor ?? 2,
      maxRetries: options.reconnect?.maxRetries ?? Infinity,
    };
  }

  getState(): OcppConnectionState {
    return this.state;
  }

  /** Registers a handler for an incoming CALL for the given action. Replaces any existing one. */
  registerHandler<TPayload = Record<string, unknown>, TResult = Record<string, unknown>>(
    action: string,
    handler: OcppActionHandler<TPayload, TResult>,
  ): void {
    this.handlers.set(action, handler as OcppActionHandler);
  }

  unregisterHandler(action: string): void {
    this.handlers.delete(action);
  }

  /** Opens the connection. No-op if already connecting or connected. */
  connect(): void {
    if (this.state === "connecting" || this.state === "connected") return;
    this.manualClose = false;
    this.reconnectAttempt = 0;
    this.openSocket();
  }

  /** Closes the connection and disables auto-reconnect for this close. */
  disconnect(code = 1000, reason = "Client disconnect"): void {
    this.manualClose = true;
    this.clearReconnectTimer();
    if (this.ws && (this.state === "connected" || this.state === "connecting")) {
      this.state = "closing";
      this.ws.close(code, reason);
    } else {
      this.state = "disconnected";
    }
  }

  /**
   * Sends a CALL and resolves with the CALLRESULT payload, or rejects with an
   * OcppCallError (on CALLERROR), OcppTimeoutError, or OcppConnectionClosedError.
   */
  call(
    action: string,
    payload: Record<string, unknown> = {},
    timeoutMs: number = this.callTimeoutMs,
  ): Promise<Record<string, unknown>> {
    if (this.state !== "connected" || !this.ws) {
      return Promise.reject(
        new Error(`Cannot send ${action}: OCPP client is not connected (state=${this.state})`),
      );
    }
    const ws = this.ws;
    const messageId = randomUUID();
    const message: OcppCallMessage = [OcppMessageTypeId.CALL, messageId, action, payload];

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCalls.delete(messageId);
        reject(new OcppTimeoutError(action, messageId));
      }, timeoutMs);

      this.pendingCalls.set(messageId, { action, resolve, reject, timeout });

      ws.send(JSON.stringify(message), (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pendingCalls.delete(messageId);
          reject(err);
        }
      });
    });
  }

  private openSocket(): void {
    this.state = "connecting";
    this.emit("connecting", this.reconnectAttempt);

    const ws = new WebSocket(this.url, [this.subprotocol]);
    this.ws = ws;
    ws.on("open", () => this.handleOpen(ws));
    ws.on("message", (data) => this.handleMessage(data));
    ws.on("close", (code, reason) => this.handleClose(code, reason));
    ws.on("error", (err) => this.emit("error", err));
  }

  private handleOpen(ws: WebSocket): void {
    if (ws.protocol !== this.subprotocol) {
      this.emit(
        "error",
        new Error(
          `CSMS did not negotiate the '${this.subprotocol}' subprotocol (got '${ws.protocol || ""}')`,
        ),
      );
      ws.close(1002, "Subprotocol not acceptable");
      return;
    }
    this.reconnectAttempt = 0;
    this.state = "connected";
    this.emit("connected");
  }

  private handleClose(code: number, reasonBuf: Buffer): void {
    const wasManual = this.manualClose;
    this.ws = null;
    this.state = "disconnected";
    this.rejectAllPending();
    this.emit("disconnected", { code, reason: reasonBuf.toString(), wasClean: wasManual });

    if (!wasManual && this.reconnectOptions.enabled) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= this.reconnectOptions.maxRetries) return;

    const delay = Math.min(
      this.reconnectOptions.initialDelayMs * this.reconnectOptions.factor ** this.reconnectAttempt,
      this.reconnectOptions.maxDelayMs,
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private rejectAllPending(): void {
    for (const [messageId, pending] of this.pendingCalls) {
      clearTimeout(pending.timeout);
      pending.reject(new OcppConnectionClosedError(pending.action, messageId));
    }
    this.pendingCalls.clear();
  }

  private handleMessage(data: RawData): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      this.emit("error", new Error("Received malformed (non-JSON) OCPP message"));
      return;
    }

    if (!Array.isArray(parsed) || parsed.length < 3) {
      this.emit("error", new Error("Received malformed OCPP message frame"));
      return;
    }

    switch (parsed[0]) {
      case OcppMessageTypeId.CALL:
        void this.handleIncomingCall(parsed as OcppCallMessage);
        return;
      case OcppMessageTypeId.CALLRESULT:
        this.handleCallResult(parsed as OcppCallResultMessage);
        return;
      case OcppMessageTypeId.CALLERROR:
        this.handleCallErrorFrame(parsed as OcppCallErrorMessage);
        return;
      default:
        this.emit("error", new Error(`Received OCPP message with unknown type id: ${String(parsed[0])}`));
    }
  }

  private async handleIncomingCall([, messageId, action, payload]: OcppCallMessage): Promise<void> {
    const handler = this.handlers.get(action);
    if (!handler) {
      this.sendCallError(messageId, "NotImplemented", `No handler registered for action '${action}'`);
      return;
    }

    try {
      const result = await handler(payload ?? {}, { action, messageId });
      this.sendFrame([OcppMessageTypeId.CALLRESULT, messageId, result ?? {}]);
    } catch (err) {
      if (err instanceof OcppCallError) {
        this.sendCallError(messageId, err.errorCode, err.errorDescription, err.errorDetails);
      } else {
        this.sendCallError(messageId, "InternalError", err instanceof Error ? err.message : String(err));
      }
    }
  }

  private handleCallResult([, messageId, payload]: OcppCallResultMessage): void {
    const pending = this.pendingCalls.get(messageId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingCalls.delete(messageId);
    pending.resolve(payload ?? {});
  }

  private handleCallErrorFrame([, messageId, errorCode, errorDescription, errorDetails]: OcppCallErrorMessage): void {
    const pending = this.pendingCalls.get(messageId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingCalls.delete(messageId);
    pending.reject(new OcppCallError(errorCode, errorDescription, errorDetails ?? {}));
  }

  private sendCallError(
    messageId: string,
    errorCode: OcppErrorCode,
    errorDescription: string,
    errorDetails: Record<string, unknown> = {},
  ): void {
    this.sendFrame([OcppMessageTypeId.CALLERROR, messageId, errorCode, errorDescription, errorDetails]);
  }

  private sendFrame(frame: OcppCallResultMessage | OcppCallErrorMessage): void {
    if (!this.ws || this.state !== "connected") {
      this.emit("error", new Error("Cannot send OCPP frame: not connected"));
      return;
    }
    this.ws.send(JSON.stringify(frame));
  }
}
