import { EventEmitter } from "node:events";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OcppEventMap = Record<string, any[]>;

/** Thin typed wrapper around Node's EventEmitter, scoped to a fixed event/args map. */
export class TypedEventEmitter<TEvents extends OcppEventMap> {
  private readonly emitter = new EventEmitter();

  on<K extends keyof TEvents & string>(
    event: K,
    listener: (...args: TEvents[K]) => void,
  ): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  once<K extends keyof TEvents & string>(
    event: K,
    listener: (...args: TEvents[K]) => void,
  ): this {
    this.emitter.once(event, listener as (...args: unknown[]) => void);
    return this;
  }

  off<K extends keyof TEvents & string>(
    event: K,
    listener: (...args: TEvents[K]) => void,
  ): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  protected emit<K extends keyof TEvents & string>(event: K, ...args: TEvents[K]): boolean {
    return this.emitter.emit(event, ...args);
  }
}
