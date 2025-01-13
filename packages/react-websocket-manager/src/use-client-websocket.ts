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
> extends Partial<ClientWebSocketManagerConfig<TIncoming, TOutgoing>> {
    manager?: ClientWebSocketManager<TIncoming, TOutgoing>;
    // TODO: Add these on the manager 
    // onManagerInstantiated?: (manager: ClientWebSocketManager<TIncoming, TOutgoing>) => void;
    // onMessageReceived?: (message: TIncoming) => void;
    // onMessageSent?: (message: TOutgoing) => void;
    // onDisconnect?: () => void;
}

export function useClientWebSocket<
    TIncoming extends BaseServerMessage = BaseServerMessage,
    TOutgoing extends BaseClientMessage = BaseClientMessage
>(config: UseClientWebSocketConfig<TIncoming, TOutgoing>) {
    const [isOpen, setIsOpen] = useState(false);
    const managerRef = useRef<ClientWebSocketManager<TIncoming, TOutgoing> | null>(null);

    // Initialize WebSocket manager only if it doesn't already exist
    if (!managerRef.current) {
        if (config.manager) {
            managerRef.current = config.manager;
        } else if (config.url) {
            managerRef.current = new ClientWebSocketManager<TIncoming, TOutgoing>({
                url: config.url,
                debug: config.debug,
                messageHandlers: config.messageHandlers,
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
            throw new Error(
                "useClientWebSocket error: 'url' is required if no existing manager is provided."
            );
        }
    }

    const manager = managerRef.current;

    useEffect(() => {
        return () => {
            if (!config.manager) {
                manager.disconnect();
            }
        };
    }, [manager, config.manager]);

    const sendMessage = useCallback(
        (msg: TOutgoing) => {
            manager.sendMessage(msg);
        },
        [manager]
    );

    const disconnect = useCallback(() => {
        manager.disconnect();
    }, [manager]);

    return {
        manager,
        isOpen,
        sendMessage,
        disconnect,
    };
}