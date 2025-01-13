import { useCallback, useEffect, useMemo, useState } from "react";
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
}

export function useClientWebSocket<
    TIncoming extends BaseServerMessage = BaseServerMessage,
    TOutgoing extends BaseClientMessage = BaseClientMessage
>(config: UseClientWebSocketConfig<TIncoming, TOutgoing>) {
    const [isOpen, setIsOpen] = useState(false);

    // Conditionally create the manager if none was provided
    const manager = useMemo(() => {
        if (config.manager) {
            return config.manager;
        }

        // If we get here, we must have a URL to create a new manager
        if (!config.url) {
            throw new Error(
                "useClientWebSocket error: 'url' is required if no existing manager is provided."
            );
        }

        return new ClientWebSocketManager<TIncoming, TOutgoing>({
            // non-null assertion because we just checked
            url: config.url!,
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
    }, [config, setIsOpen]);

    useEffect(() => {
        if (!config.manager) {
            return () => {
                manager.disconnect();
            };
        }
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