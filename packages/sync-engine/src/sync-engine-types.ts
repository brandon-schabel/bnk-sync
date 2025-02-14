import type { ServerWebSocket } from "bun";

/**
 * Base interface for all WebSocket messages (client->server or server->client).
 */
export interface BaseMessage {
    type: string;
}

/**
 * A generic message handler interface that can handle
 * messages of a certain `type`.
 */
export interface MessageHandler<TState, TMessage extends BaseMessage> {
    /**
     * The message type that this handler is responsible for processing.
     */
    type: TMessage["type"];

    /**
     * Handle the incoming message.
     * @param ws       - The connected WebSocket
     * @param message  - The received message
     * @param getState - A function to retrieve current state
     * @param setState - A function to persist updated state
     */
    handle: (
        ws: ServerWebSocket<any>,
        message: TMessage,
        getState: () => Promise<TState>,
        setState: (updated: TState) => Promise<void>
    ) => Promise<void>;
}

/**
 * Hooks that can be provided to the SyncEngine for executing
 * custom logic at various lifecycle events.
 */
export interface SyncEngineHooks<TState> {
    /**
     * Called whenever a new client connects.
     */
    onConnect?: (ws: ServerWebSocket<any>) => Promise<void>;

    /**
     * Called whenever a client disconnects.
     */
    onDisconnect?: (ws: ServerWebSocket<any>) => Promise<void>;

    /**
     * Called whenever the manager's state is updated.
     */
    onStateChange?: (oldState: TState, newState: TState) => Promise<void>;

    /**
     * Called when the manager's data is persisted.
     */
    onSync?: (state: TState, version: number) => Promise<void>;

    /**
     * Called when a backup is created.
     */
    onBackup?: (timestamp: number, version: number) => Promise<void>;

    /**
     * Called when the server sends a "ping" message to a client.
     */
    onPing?: (ws: ServerWebSocket<any>) => Promise<void>;

    /**
     * Called when the server receives a "pong" message from a client.
     */
    onPong?: (ws: ServerWebSocket<any>) => Promise<void>;

    /**
     * Called if a client fails to respond to a ping message in time.
     */
    onPingTimeout?: (ws: ServerWebSocket<any>) => Promise<void>;

    /**
     * Called when any internal error occurs in the manager. Use this to
     * centralize your error logging or tracking.
     */
    onError?: (error: unknown, context?: string) => Promise<void>;
}

/**
 * An interface for adapters that can persist the SyncEngine's state.
 */
export interface SyncEnginePersistenceAdapter<TState> {
    init(): Promise<void>;
    load(): Promise<VersionedSyncData<TState>>;
    save(state: TState, version: number): Promise<void>;
    backup?(): Promise<void>;
}

/**
 * Shape of data loaded/stored by the persistence adapter.
 */
export interface VersionedSyncData<TState> {
    state: TState;
    version: number;
}

/**
 * Optional "middleware" concept for message processing.
 */
export type SyncMiddleware<TMessage extends BaseMessage> = (
    message: TMessage
) => Promise<TMessage>;

/**
 * Configuration object for the generic WebSocket manager.
 */
export interface SyncEngineConfig<TState, TMessage extends BaseMessage> {
    /**
     * Initial state if no adapter is provided or if adapter load fails.
     */
    initialState?: TState;

    /**
     * A default fallback state if neither adapter nor `initialState` can provide valid data.
     */
    defaultState?: TState;

    /**
     * An array of message handlers.
     */
    messageHandlers: Array<MessageHandler<TState, TMessage>>;

    /**
     * Optional debug flag for logging.
     */
    debug?: boolean;

    /**
     * Optional hooks for lifecycle events and error handling.
     */
    hooks?: SyncEngineHooks<TState>;

    /**
     * Milliseconds to wait before sending a ping to each client.
     */
    heartbeatIntervalMs?: number;

    /**
     * Milliseconds to wait for a pong response before marking a client as timed out.
     */
    pingTimeoutMs?: number;

    /**
     * Optional function or library schema for validating incoming messages.
     */
    validateMessage?: (rawMessage: unknown) => TMessage;

    /**
     * Optional adapter for persistence.
     */
    adapter?: SyncEnginePersistenceAdapter<TState>;

    /**
     * If true, each data mutation increments an internal version.
     */
    enableVersioning?: boolean;

    /**
     * If set, automatically call manager.sync() at the given interval (ms).
     */
    syncIntervalMs?: number;
}