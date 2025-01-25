// packages/react-websocket-manager/src/use-client-websocket.ts

import { useCallback, useEffect, useRef, useState } from "react";
import {
    ClientWebSocketManager,
} from "@bnk/client-websocket-manager";
import type {
    BaseServerMessage,
    BaseClientMessage,
    ClientWebSocketManagerConfig,
} from "@bnk/client-websocket-manager";

export interface UseClientWebSocketConfig<
    TIncoming extends BaseServerMessage = BaseServerMessage,
    TOutgoing extends BaseClientMessage = BaseClientMessage
> {
    /**
     * Optionally provide a pre-instantiated manager (skips creating a new one).
     */
    manager?: ClientWebSocketManager<TIncoming, TOutgoing>;

    /**
     * Configuration for creating a new manager if one isn't provided.
     */
    config?: Partial<ClientWebSocketManagerConfig<TIncoming, TOutgoing>>;
}

/**
 * React hook for conveniently managing a WebSocket connection in a React app.
 * Allows optional message validation for both incoming and outgoing data.
 */
export function useClientWebSocket<
    TIncoming extends BaseServerMessage = BaseServerMessage,
    TOutgoing extends BaseClientMessage = BaseClientMessage
>({
    config,
    manager: managerProp,
}: UseClientWebSocketConfig<TIncoming, TOutgoing>) {
    const [isOpen, setIsOpen] = useState(false);
    const managerRef = useRef<ClientWebSocketManager<TIncoming, TOutgoing> | null>(null);

    // Initialize the WebSocket manager only if it doesn't already exist
    if (!managerRef.current) {
        // If no manager was passed in, we create one from config
        if (!managerProp) {
            if (!config?.url) {
                throw new Error(
                    "useClientWebSocket error: 'url' is required if no existing manager is provided."
                );
            }
            managerRef.current = new ClientWebSocketManager<TIncoming, TOutgoing>({
                url: config.url,
                debug: config.debug,
                autoReconnect: config.autoReconnect,
                reconnectIntervalMs: config.reconnectIntervalMs,
                maxReconnectAttempts: config.maxReconnectAttempts,
                onReconnect: config.onReconnect,
                messageHandlers: config.messageHandlers,
                validateIncomingMessage: config.validateIncomingMessage,
                validateOutgoingMessage: config.validateOutgoingMessage,
                onOpen: () => {
                    setIsOpen(true);
                    config.onOpen?.();
                },
                onClose: (event) => {
                    setIsOpen(false);
                    config.onClose?.(event);
                },
                onError: config.onError,
            });
        } else {
            managerRef.current = managerProp;
        }
    }

    const manager = managerRef.current;

    // On unmount, optionally disconnect
    useEffect(() => {
        return () => {
            managerRef.current?.disconnect();
        };
    }, [manager]);

    /**
     * Send a message to the server using the manager
     */
    const sendMessage = useCallback(
        (msg: TOutgoing) => {
            manager?.sendMessage(msg);
        },
        [manager]
    );

    /**
     * Manually disconnect (and optionally stop reconnect attempts)
     */
    const disconnect = useCallback(
        (stopReconnect = false) => {
            manager?.disconnect(stopReconnect);
        },
        [manager]
    );

    return {
        manager,
        isOpen,
        sendMessage,
        disconnect,
    };
}