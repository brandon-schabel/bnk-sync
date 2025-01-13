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
    manager?: ClientWebSocketManager<TIncoming, TOutgoing>;
    config?: Partial<ClientWebSocketManagerConfig<TIncoming, TOutgoing>>
    // TODO: Add these on the manager 
    // onManagerInstantiated?: (manager: ClientWebSocketManager<TIncoming, TOutgoing>) => void;
    // onMessageReceived?: (message: TIncoming) => void;
    // onMessageSent?: (message: TOutgoing) => void;
    // onDisconnect?: () => void;
}

export function useClientWebSocket<
    TIncoming extends BaseServerMessage = BaseServerMessage,
    TOutgoing extends BaseClientMessage = BaseClientMessage
>({ config, manager: managerProp }: UseClientWebSocketConfig<TIncoming, TOutgoing>) {
    const [isOpen, setIsOpen] = useState(false);
    const managerRef = useRef<ClientWebSocketManager<TIncoming, TOutgoing> | null>(null);

    // Initialize WebSocket manager only if it doesn't already exist
    if (!managerRef.current) {

        if (config && !config.url) {
            throw new Error(
                "useClientWebSocket error: 'url' is required if no existing manager is provided."
            );
        }

        if (managerProp) {
            managerRef.current = managerProp;
        } else if (config) {
            managerRef.current = new ClientWebSocketManager<TIncoming, TOutgoing>({
                url: config.url ?? 'no-url',
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
        }
    }

    const manager = managerRef.current;

    useEffect(() => {
        return () => {
            if (!manager) {
                managerRef.current?.disconnect();
            }
        };
    }, [manager, managerProp]);

    const sendMessage = useCallback(
        (msg: TOutgoing) => {
            manager?.sendMessage(msg);
        },
        [manager]
    );

    const disconnect = useCallback(() => {
        manager?.disconnect();
    }, [manager]);

    return {
        manager,
        isOpen,
        sendMessage,
        disconnect,
    };
}