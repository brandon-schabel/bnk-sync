import type { BaseServerMessage, BaseClientMessage } from "./sync-client-types";

/**
 * Configuration for our client-side manager.
 */
export interface SyncClientManagerConfig<
    TIncoming extends BaseServerMessage = BaseServerMessage,
    TOutgoing extends BaseClientMessage = BaseClientMessage
> {
    /**
 * The URL to which we connect. e.g. "ws://localhost:3007"
     */
    url: string;

    /**
     * Optional debug mode for console logs.
     */
    debug?: boolean;

    /**
     * Called whenever the WebSocket successfully opens.
     */
    onOpen?: () => void;

    /**
     * Called whenever the WebSocket closes.
     */
    onClose?: (event: CloseEvent) => void;

    /**
     * Called when an error occurs.
     */
    onError?: (event: Event) => void;

    /**
     * A map of handlers keyed by `message.type`, so you can handle each incoming
     * message type in a well-typed, pluggable way.
     */
    messageHandlers?: {
        [K in TIncoming["type"]]?: (
            message: Extract<TIncoming, { type: K }>
        ) => void;
    };

    /**
     * If true, automatically attempt to reconnect on close.
     */
    autoReconnect?: boolean;

    /**
     * Delay (in ms) between reconnect attempts.
     */
    reconnectIntervalMs?: number;

    /**
     * Max number of reconnect attempts before giving up (default: infinite).
     */
    maxReconnectAttempts?: number;

    /**
     * Called each time a reconnect attempt starts.
     */
    onReconnect?: (attemptNumber: number) => void;

    /**
     * Optional function or schema to validate incoming messages from the server.
     * If provided, it should throw on invalid data or return a valid `TIncoming`.
     */
    validateIncomingMessage?: (raw: unknown) => TIncoming;

    /**
     * Optional function or schema to validate outgoing messages before sending.
     * If provided, it should throw on invalid data or return a valid `TOutgoing`.
     */
    validateOutgoingMessage?: (msg: TOutgoing) => TOutgoing;
}

/**
 * A generic client-side WebSocket Manager that can optionally validate both incoming
 * and outgoing messages. This ensures type safety when using a shared Zod schema.
 */
export class SyncClientManager<
    TIncoming extends BaseServerMessage = BaseServerMessage,
    TOutgoing extends BaseClientMessage = BaseClientMessage
> {
    private config: SyncClientManagerConfig<TIncoming, TOutgoing>;
    private socket: WebSocket | null = null;
    private reconnectAttempts = 0;
    private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private rawMessageListeners: Array<(data: unknown) => void> = [];

    /**
     * Allows external code to listen to every incoming (parsed) message
     * before the built-in typed handlers run.
     * Returns an unsubscribe function.
     */
    public addRawMessageListener(listener: (data: unknown) => void): () => void {
        this.rawMessageListeners.push(listener);
        return () => {
            this.rawMessageListeners = this.rawMessageListeners.filter(l => l !== listener);
        };
    }

    constructor(config: SyncClientManagerConfig<TIncoming, TOutgoing>) {
        this.config = config;
        this.connect();
    }

    /**
     * Create and open the WebSocket connection.
     */
    private connect() {
        const { url, debug } = this.config;

        if (debug) {
            console.log(`[SyncClientManager] Connecting to ${url} ...`);
        }

        this.socket = new WebSocket(url);
        this.socket.addEventListener("open", this.handleOpen);
        this.socket.addEventListener("close", this.handleClose);
        this.socket.addEventListener("error", this.handleError);
        this.socket.addEventListener("message", this.handleMessage);
    }

    /**
     * Close the WebSocket connection gracefully,
     * and optionally prevent further reconnect attempts.
     */
    public disconnect(stopReconnectAttempts = false) {
        if (stopReconnectAttempts) {
            this.clearReconnectTimer();
            this.reconnectAttempts = 0;
        }

        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            if (this.config.debug) {
                console.log("[SyncClientManager] Closing connection");
            }
            this.socket.close();
        }
    }

    /**
     * Send a strongly-typed message to the server,
     * optionally validating it first if `validateOutgoingMessage` is set.
     */
    public sendMessage(msg: TOutgoing) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            if (this.config.debug) {
                console.warn("[SyncClientManager] Cannot send, socket not open:", msg);
            }
            return;
        }

        try {
            let validated = msg;
            if (this.config.validateOutgoingMessage) {
                validated = this.config.validateOutgoingMessage(msg);
            }
            const str = JSON.stringify(validated);
            this.socket.send(str);
        } catch (error) {
            console.error("[SyncClientManager] Error validating/sending message:", error);
        }
    }

    /**
     * Called when WebSocket opens.
     */
    private handleOpen = () => {
        if (this.config.debug) {
            console.log("[SyncClientManager] Connection opened");
        }
        // Reset reconnect attempts on successful connection.
        this.reconnectAttempts = 0;
        this.clearReconnectTimer();

        this.config.onOpen?.();
    };

    /**
     * Called when WebSocket closes.
     */
    private handleClose = (event: CloseEvent) => {
        if (this.config.debug) {
            console.log("[SyncClientManager] Connection closed:", event.reason);
        }
        this.config.onClose?.(event);

        // Trigger auto reconnect if enabled
        if (this.config.autoReconnect) {
            const maxAttempts = this.config.maxReconnectAttempts ?? Infinity;
            if (this.reconnectAttempts < maxAttempts) {
                this.reconnectAttempts += 1;
                this.config.onReconnect?.(this.reconnectAttempts);

                this.reconnectTimeoutId = setTimeout(() => {
                    if (this.config.debug) {
                        console.log(
                            `[SyncClientManager] Attempting reconnect (#${this.reconnectAttempts}) ...`
                        );
                    }
                    this.connect();
                }, this.config.reconnectIntervalMs ?? 2000);
            } else if (this.config.debug) {
                console.warn(
                    `[SyncClientManager] Max reconnect attempts reached (${maxAttempts}).`
                );
            }
        }
    };

    /**
     * Called on a WebSocket error.
     */
    private handleError = (event: Event) => {
        if (this.config.debug) {
            console.error("[SyncClientManager] Connection error:", event);
        }
        this.config.onError?.(event);
    };

    /**
     * Called when a message arrives from the server.
     * Optionally validates the data if `validateIncomingMessage` is set.
     */
    private handleMessage = (event: MessageEvent) => {
        let parsed: unknown;
        try {
            parsed = JSON.parse(event.data);
        } catch (err) {
            console.error("[SyncClientManager] Failed to parse incoming data:", err);
            return;
        }

        // 1) Notify raw-message listeners first
        this.rawMessageListeners.forEach((fn) => {
            try {
                fn(parsed);
            } catch (listenerError) {
                console.error("[SyncClientManager] Error in raw message listener:", listenerError);
            }
        });

        // 2) Then continue with optional validation and typed handlers
        let incoming: TIncoming;
        if (this.config.validateIncomingMessage) {
            try {
                incoming = this.config.validateIncomingMessage(parsed);
            } catch (validationError) {
                console.error("[SyncClientManager] Incoming message validation failed:", validationError);
                return;
            }
        } else {
            incoming = parsed as TIncoming;
        }

        const typeKey = incoming.type as TIncoming["type"];
        const handler = this.config.messageHandlers?.[typeKey];
        if (handler) {
            handler(incoming as Extract<TIncoming, { type: typeof typeKey }>);
        } else if (this.config.debug) {
            console.warn("[SyncClientManager] No handler for message type:", incoming.type);
        }
    };

    /**
     * Clear any pending reconnect timers.
     */
    private clearReconnectTimer() {
        if (this.reconnectTimeoutId) {
            clearTimeout(this.reconnectTimeoutId);
            this.reconnectTimeoutId = null;
        }
    }
}