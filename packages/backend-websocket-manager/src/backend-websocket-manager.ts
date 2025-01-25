import type { ServerWebSocket } from "bun";
import type {
  BaseMessage,
  MessageHandler,
  BackendWebSocketManagerConfig,
  BackendWebSocketManagerHooks,
  BackendWebSocketPersistenceAdapter,
  VersionedWebSocketData,
  WebSocketMiddleware,
} from "./backend-websocket-types";


/**
 * A generic WebSocket manager that can handle a variety of states and messages.
 * 
 * @template TState - The shape of your application's state
 * @template TMessage - The union of all message types that may be handled
 */
export class BackendWebSocketManager<
    TState,
    TMessage extends BaseMessage
> {
    private connections: Set<ServerWebSocket<any>>;
    private config: BackendWebSocketManagerConfig<TState, TMessage>;

    /**
     * Middleware array. Each middleware processes a TMessage
     * and returns a (possibly transformed) TMessage.
     */
    private middlewares: Array<WebSocketMiddleware<TMessage>> = [];

    /**
     * Keeps track of timestamps (in ms) of the last pong received from each client.
     * Used for heartbeat/ping checks.
     */
    private lastPongTimes: Map<ServerWebSocket<any>, number>;

    // New state management
    private state: TState;
    private version: number;
    private adapter?: BackendWebSocketPersistenceAdapter<TState>;

    private heartbeatTimer?: ReturnType<typeof setInterval>;
    private syncInterval?: ReturnType<typeof setInterval>;

    constructor(config: BackendWebSocketManagerConfig<TState, TMessage>) {
        this.config = config;
        this.connections = new Set();
        this.lastPongTimes = new Map();

        // Initialize versioning
        this.version = config.enableVersioning ? 0 : -1;
        this.adapter = config.adapter;
        this.state = config.initialState as TState;

        if (this.config.debug) {
            console.log("[WebSocketManager] Initialized with debug = true");
        }

        // Initialize adapter and load state
        void this.init();

        // Start heartbeat if configured
        if (config.heartbeatIntervalMs && config.heartbeatIntervalMs > 0) {
            this.startHeartbeat();
        }

        // Start sync interval if configured
        if (config.syncIntervalMs && config.syncIntervalMs > 0) {
            this.startSyncInterval(config.syncIntervalMs);
        }
    }

    /**
     * Register a new middleware function that processes incoming messages.
     */
    public async use(middleware: WebSocketMiddleware<TMessage>): Promise<void> {
        this.middlewares.push(middleware);
    }

    /**
     * Starts the heartbeat/ping cycle if not already started.
     */
    private startHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }

        this.heartbeatTimer = setInterval(() => {
            for (const ws of this.connections) {
                if (ws.readyState === WebSocket.OPEN) {
                    void this.sendPing(ws);
                }
            }
        }, this.config.heartbeatIntervalMs);
    }

    /**
     * Sends a ping message to a specific client.
     */
    private async sendPing(ws: ServerWebSocket<any>): Promise<void> {
        try {
            ws.send(JSON.stringify({ type: "ping" }));
            if (this.config.hooks?.onPing) {
                await this.config.hooks.onPing(ws);
            }

            if (this.config.pingTimeoutMs && this.config.pingTimeoutMs > 0) {
                setTimeout(async () => {
                    const lastPong = this.lastPongTimes.get(ws) || 0;
                    const now = Date.now();
                    if (now - lastPong > this.config.pingTimeoutMs!) {
                        if (this.config.debug) {
                            console.warn("[WebSocketManager] Ping timeout. Closing...");
                        }
                        if (this.config.hooks?.onPingTimeout) {
                            await this.config.hooks.onPingTimeout(ws);
                        }
                        ws.close();
                    }
                }, this.config.pingTimeoutMs);
            }
        } catch (error) {
            if (this.config.debug) {
                console.error("[WebSocketManager] Failed to send ping:", error);
            }
        }
    }

    /**
     * Stops the heartbeat/ping cycle.
     */
    public stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
    }

    /**
     * Handle a new connection.
     */
    public async handleOpen(ws: ServerWebSocket<any>): Promise<void> {
        this.connections.add(ws);
        this.lastPongTimes.set(ws, Date.now());

        if (this.config.debug) {
            console.log("[WebSocketManager] New connection opened.");
        }

        // Call onConnect hook if provided
        if (this.config.hooks?.onConnect) {
            await this.config.hooks.onConnect(ws);
        }

        // Send the current state to the new client
        try {
            const message = {
                type: "initial_state",
                data: this.state
            };
            ws.send(JSON.stringify(message));
        } catch (error) {
            console.error("[WebSocketManager] Error sending initial state:", error);
            ws.close();
        }
    }

    /**
     * Handle a closed connection.
     */
    public async handleClose(ws: ServerWebSocket<any>): Promise<void> {
        this.connections.delete(ws);
        this.lastPongTimes.delete(ws);

        if (this.config.debug) {
            console.log("[WebSocketManager] Connection closed.");
        }

        // Call onDisconnect hook if provided
        if (this.config.hooks?.onDisconnect) {
            await this.config.hooks.onDisconnect(ws);
        }
    }

    /**
     * Handle any raw incoming messages from clients.
     */
    public async handleMessage(ws: ServerWebSocket<any>, rawMessage: string): Promise<void> {
        if (this.config.debug) {
            console.log("[WebSocketManager] Received raw message:", rawMessage);
        }

        // Special case for "pong": we track that we've received a pong for heartbeat
        if (rawMessage === "pong") {
            if (this.config.debug) {
                console.log("[WebSocketManager] Received pong");
            }
            this.lastPongTimes.set(ws, Date.now());
            if (this.config.hooks?.onPong) {
                await this.config.hooks.onPong(ws);
            }
            return;
        }

        let parsed: TMessage;
        try {
            // If a validator is provided, use it. Otherwise fallback to JSON.parse
            parsed = this.config.validateMessage
                ? this.config.validateMessage(JSON.parse(rawMessage))
                : (JSON.parse(rawMessage) as TMessage);
        } catch (error) {
            console.error("[WebSocketManager] Failed to parse or validate message:", error);
            return;
        }

        // Pass the parsed message through all registered middlewares
        for (const mw of this.middlewares) {
            try {
                parsed = await mw(parsed);
            } catch (middlewareError) {
                console.error("[WebSocketManager] Middleware error:", middlewareError);
                return;
            }
        }

        // Find a handler that matches the parsed type
        const handler = this.config.messageHandlers.find((h) => h.type === parsed.type);
        if (!handler) {
            if (this.config.debug) {
                console.warn("[WebSocketManager] No handler found for message type:", parsed.type);
            }
            return;
        }

        // Run the handler with internal state management
        try {
            const oldState = this.state;

            await handler.handle(
                ws,
                parsed,
                async () => this.state,
                async (updated: TState) => {
                    if (this.version >= 0) {
                        this.version++;
                    }
                    this.state = updated;
                    
                    // If changed, call onStateChange if provided
                    if (this.config.hooks?.onStateChange && 
                        JSON.stringify(oldState) !== JSON.stringify(updated)) {
                        await this.config.hooks.onStateChange(oldState, updated);
                    }

                    // Sync if we have an adapter
                    await this.sync();
                }
            );
        } catch (error) {
            console.error("[WebSocketManager] Error in handler:", error);
        }
    }

    /**
     * Broadcast helper to send the entire updated state to all clients.
     */
    public async broadcastState(): Promise<void> {
        try {
            const message = {
                type: "state_update",
                data: this.state
            };
            const serialized = JSON.stringify(message);

            let successCount = 0;
            let failCount = 0;

            for (const conn of this.connections) {
                try {
                    conn.send(serialized);
                    successCount++;
                } catch (error) {
                    failCount++;
                    if (this.config.debug) {
                        console.error("[WebSocketManager] Failed to send state update:", error);
                    }
                }
            }

            if (this.config.debug) {
                console.log("[WebSocketManager] Broadcast complete:", {
                    totalConnections: this.connections.size,
                    successCount,
                    failCount
                });
            }
        } catch (error) {
            console.error("[WebSocketManager] Broadcast error:", error);
        }
    }

    /**
     * Initialize adapter and load state
     */
    private async init(): Promise<void> {
        if (!this.adapter) return;
        
        await this.adapter.init();
        const data = await this.adapter.load();
        this.state = data.state;
        
        if (this.config.enableVersioning && typeof data.version === "number") {
            this.version = data.version;
        }
    }

    /**
     * Start periodic sync if configured
     */
    private startSyncInterval(intervalMs: number): void {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }
        this.syncInterval = setInterval(() => {
            void this.sync();
        }, intervalMs);
    }

    /**
     * Sync state to adapter
     */
    public async sync(): Promise<void> {
        if (!this.adapter) return;
        
        await this.adapter.save(this.state, this.version);
        if (this.config.hooks?.onSync) {
            await this.config.hooks.onSync(this.state, this.version);
        }
    }

    /**
     * Create backup if adapter supports it
     */
    public async createBackup(): Promise<void> {
        if (!this.adapter?.backup) return;
        
        await this.adapter.backup();
        if (this.config.hooks?.onBackup) {
            await this.config.hooks.onBackup(Date.now(), this.version);
        }
    }

    /**
     * Return the current version number
     */
    public getVersion(): number {
        return this.version;
    }

    /**
     * Return the current state
     */
    public getState(): TState {
        return this.state;
    }

    /**
     * Clean up resources
     */
    public dispose(): void {
        // Close all connections
        for (const ws of this.connections) {
            try {
                ws.close();
            } catch {
                // ignore errors
            }
        }
        this.connections.clear();
        this.lastPongTimes.clear();

        // Clear intervals
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = undefined;
        }
    }
}