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
 * @template TState   - The shape of your application's state
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

    // State management
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

        // Decide initial state with fallback
        // If initialState is defined, use that, otherwise use config.defaultState,
        // otherwise an empty object casted to TState
        this.state =
            config.initialState ??
            config.defaultState ??
            ({} as TState);

        this.debugLog(
            "[WebSocketManager] Initializing with state:",
            this.state
        );

        // Initialize adapter and load state
        void this.init().then(() => {
            this.debugLog("[WebSocketManager] Adapter initialization complete.");
        });

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
     * Utility for debug logging. Only logs if config.debug is true.
     */
    private debugLog(...args: unknown[]): void {
        if (this.config.debug) {
            console.log(...args);
        }
    }

    /**
     * Central place to handle/report errors. If `onError` is provided, it will be used;
     * otherwise falls back to console.error.
     */
    private async reportError(error: unknown, context: string): Promise<void> {
        if (this.config.hooks?.onError) {
            await this.config.hooks.onError(error, context);
        } else {
            console.error(`${context}`, error);
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
                        this.debugLog("[WebSocketManager] Ping timeout. Closing connection...");
                        if (this.config.hooks?.onPingTimeout) {
                            await this.config.hooks.onPingTimeout(ws);
                        }
                        ws.close();
                    }
                }, this.config.pingTimeoutMs);
            }
        } catch (error) {
            await this.reportError(error, "[WebSocketManager] Failed to send ping:");
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

        this.debugLog("[WebSocketManager] New connection opened.");

        // Call onConnect hook if provided
        if (this.config.hooks?.onConnect) {
            try {
                await this.config.hooks.onConnect(ws);
            } catch (error) {
                await this.reportError(error, "[WebSocketManager] Error in onConnect hook:");
            }
        }

        // Send the current state to the new client
        try {
            const message = {
                type: "initial_state",
                data: this.state,
            };
            ws.send(JSON.stringify(message));
        } catch (error) {
            await this.reportError(error, "[WebSocketManager] Error sending initial state:");
            ws.close();
        }
    }

    /**
     * Handle a closed connection.
     */
    public async handleClose(ws: ServerWebSocket<any>): Promise<void> {
        this.connections.delete(ws);
        this.lastPongTimes.delete(ws);

        this.debugLog("[WebSocketManager] Connection closed.");

        // Call onDisconnect hook if provided
        if (this.config.hooks?.onDisconnect) {
            try {
                await this.config.hooks.onDisconnect(ws);
            } catch (error) {
                await this.reportError(error, "[WebSocketManager] Error in onDisconnect hook:");
            }
        }
    }

    /**
     * Handle any raw incoming messages from clients.
     */
    public async handleMessage(
        ws: ServerWebSocket<any>,
        rawMessage: string
    ): Promise<void> {
        this.debugLog("[WebSocketManager] Received raw message:", rawMessage);

        // Special case for "pong": track the pong for heartbeat
        if (rawMessage === "pong") {
            this.debugLog("[WebSocketManager] Received pong");
            this.lastPongTimes.set(ws, Date.now());
            if (this.config.hooks?.onPong) {
                try {
                    await this.config.hooks.onPong(ws);
                } catch (error) {
                    await this.reportError(error, "[WebSocketManager] Error in onPong hook:");
                }
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
            await this.reportError(error, "[WebSocketManager] Failed to parse/validate message:");
            return;
        }

        // Pass the parsed message through all registered middlewares
        for (const mw of this.middlewares) {
            try {
                parsed = await mw(parsed);
            } catch (middlewareError) {
                await this.reportError(middlewareError, "[WebSocketManager] Middleware error:");
                return;
            }
        }

        // Find a handler that matches the parsed type
        const handler = this.config.messageHandlers.find((h) => h.type === parsed.type);
        if (!handler) {
            this.debugLog("[WebSocketManager] No handler found for message type:", parsed.type);
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
                    if (
                        this.config.hooks?.onStateChange &&
                        JSON.stringify(oldState) !== JSON.stringify(updated)
                    ) {
                        try {
                            await this.config.hooks.onStateChange(oldState, updated);
                        } catch (hookError) {
                            await this.reportError(hookError, "[WebSocketManager] Error in onStateChange hook:");
                        }
                    }

                    // Sync if we have an adapter
                    await this.sync();
                }
            );
        } catch (error) {
            await this.reportError(error, "[WebSocketManager] Error in message handler:");
        }
    }

    /**
     * Broadcast helper to send the entire updated state to all clients.
     */
    public async broadcastState(): Promise<void> {
        try {
            const message = {
                type: "state_update",
                data: this.state,
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
                    await this.reportError(error, "[WebSocketManager] Failed to send state update:");
                }
            }

            this.debugLog("[WebSocketManager] Broadcast complete:", {
                totalConnections: this.connections.size,
                successCount,
                failCount,
            });
        } catch (error) {
            await this.reportError(error, "[WebSocketManager] Broadcast error:");
        }
    }

    /**
     * Initialize adapter and load state
     */
    private async init(): Promise<void> {
        if (!this.adapter) return;

        try {
            await this.adapter.init();
            const data = await this.adapter.load();

            // Validate the data to ensure it has state/version
            if (
                !data ||
                typeof data !== "object" ||
                data.state === undefined ||
                data.version === undefined
            ) {
                this.debugLog("[WebSocketManager] Adapter returned invalid data. Using fallback state.");
                this.state = this.config.defaultState ?? ({} as TState);
                if (this.version >= 0) {
                    this.version = 0;
                }
                return;
            }

            this.state = data.state;
            if (this.config.enableVersioning && typeof data.version === "number") {
                this.version = data.version;
            }
        } catch (error) {
            await this.reportError(error, "[WebSocketManager] Error initializing adapter; using fallback state:");
            this.state = this.config.defaultState ?? ({} as TState);
            if (this.version >= 0) {
                this.version = 0;
            }
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

        try {
            await this.adapter.save(this.state, this.version);
            if (this.config.hooks?.onSync) {
                await this.config.hooks.onSync(this.state, this.version);
            }
        } catch (error) {
            await this.reportError(error, "[WebSocketManager] Error syncing state:");
        }
    }

    /**
     * Create backup if adapter supports it
     */
    public async createBackup(): Promise<void> {
        if (!this.adapter?.backup) return;

        try {
            await this.adapter.backup();
            if (this.config.hooks?.onBackup) {
                await this.config.hooks.onBackup(Date.now(), this.version);
            }
        } catch (error) {
            await this.reportError(error, "[WebSocketManager] Error creating backup:");
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
     * Force-set a new state and optionally broadcast the update.
     */
    public async setState(newState: TState, broadcast = false): Promise<void> {
        const oldState = this.state;

        // If versioning is enabled, increment version
        if (this.version >= 0) {
            this.version++;
        }

        this.state = newState;

        // If changed, call onStateChange
        if (
            this.config.hooks?.onStateChange &&
            JSON.stringify(oldState) !== JSON.stringify(newState)
        ) {
            try {
                await this.config.hooks.onStateChange(oldState, newState);
            } catch (error) {
                await this.reportError(error, "[WebSocketManager] Error in onStateChange hook (setState):");
            }
        }

        // Persist updated state to adapter
        await this.sync();

        // Optional: broadcast new state to all connections
        if (broadcast) {
            await this.broadcastState();
        }
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