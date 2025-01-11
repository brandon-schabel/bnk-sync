import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { ClientWebSocketManager, type ClientWebSocketManagerConfig } from "./client-websocket-manager";
import type { BaseServerMessage, BaseClientMessage } from "./client-websocket-types";

/** 
 * 1) Create one context and export it. 
 *    It must not be in a function or you’ll get a new instance each time.
 */
const WebSocketClientContext = createContext<
    WebSocketClientContextValue<any, any> | null
>(null);

/** 
 * 2) Define the shape of the value we’ll place into the Context.
 */
export interface WebSocketClientContextValue<
    TIncoming extends BaseServerMessage = BaseServerMessage,
    TOutgoing extends BaseClientMessage = BaseClientMessage
> {
    manager: ClientWebSocketManager<TIncoming, TOutgoing>;
    isOpen: boolean;
    sendMessage: (msg: TOutgoing) => void;
    disconnect: () => void;
}

/**
 * 3) The Hook: 
 *    Just read from the single context we exported above.
 */
export function useWebSocketClient<
    TIncoming extends BaseServerMessage = BaseServerMessage,
    TOutgoing extends BaseClientMessage = BaseClientMessage
>(): WebSocketClientContextValue<TIncoming, TOutgoing> {
    const ctx = useContext(WebSocketClientContext);
    if (!ctx) {
        throw new Error("useWebSocketClient must be used within a <WebSocketClientProvider>.");
    }
    return ctx as WebSocketClientContextValue<TIncoming, TOutgoing>;
}

/** 
 * 4) The Provider: 
 *    Use the *same* shared context object for the Provider.
 */
export interface WebSocketClientProviderProps<
    TIncoming extends BaseServerMessage = BaseServerMessage,
    TOutgoing extends BaseClientMessage = BaseClientMessage
> extends ClientWebSocketManagerConfig<TIncoming, TOutgoing> {
    children: React.ReactNode;
}

export function WebSocketClientProvider<
    TIncoming extends BaseServerMessage,
    TOutgoing extends BaseClientMessage
>(props: WebSocketClientProviderProps<TIncoming, TOutgoing>) {
    const { children, ...managerConfig } = props;
    const [isOpen, setIsOpen] = useState(false);

    // We create the manager only once (or only when needed),
    // instead of re-creating a brand new context each render.
    const manager = useMemo(() => {
        return new ClientWebSocketManager<TIncoming, TOutgoing>({
            ...managerConfig,
            onOpen: () => {
                setIsOpen(true);
                managerConfig.onOpen?.();
            },
            onClose: (event) => {
                setIsOpen(false);
                managerConfig.onClose?.(event);
            },
        });
    }, [managerConfig.url, managerConfig.debug]);

    useEffect(() => {
        // On unmount, close the socket
        return () => manager.disconnect();
    }, [manager]);

    // Optional callbacks
    const sendMessage = useCallback((msg: TOutgoing) => {
        manager.sendMessage(msg);
    }, [manager]);

    const disconnect = useCallback(() => {
        manager.disconnect();
    }, [manager]);

    const value: WebSocketClientContextValue<TIncoming, TOutgoing> = {
        manager,
        isOpen,
        sendMessage,
        disconnect,
    };

    return (
        <WebSocketClientContext.Provider value={value}>
            {children}
        </WebSocketClientContext.Provider>
    );
}