import { WebSocketServer, type WebSocket } from "ws";

/** A minimal CSMS-side WebSocket server for exercising OcppClient in tests. */
export class MockCsmsServer {
  readonly connections: WebSocket[] = [];

  private constructor(private readonly wss: WebSocketServer) {
    wss.on("connection", (ws) => this.connections.push(ws));
  }

  static async start(options: { acceptSubprotocol?: boolean } = {}): Promise<MockCsmsServer> {
    const acceptSubprotocol = options.acceptSubprotocol ?? true;
    const wss = new WebSocketServer({
      port: 0,
      handleProtocols: acceptSubprotocol ? undefined : () => false,
    });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    return new MockCsmsServer(wss);
  }

  get url(): string {
    const address = this.wss.address();
    if (typeof address === "string" || !address) {
      throw new Error("Mock CSMS server is not listening");
    }
    return `ws://localhost:${address.port}`;
  }

  /** Resolves with the most recent (or next) client connection. */
  async waitForConnection(): Promise<WebSocket> {
    if (this.connections.length > 0) {
      return this.connections[this.connections.length - 1];
    }
    return new Promise((resolve) => this.wss.once("connection", (ws) => resolve(ws)));
  }

  async close(): Promise<void> {
    for (const ws of this.connections) {
      ws.terminate();
    }
    await new Promise<void>((resolve, reject) => {
      this.wss.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
