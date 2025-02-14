import React, { useContext, useMemo, useState } from "react";
import { SyncClientManager, SyncClientManagerConfig } from '@bnk/sync-client'
import {
    IncomingServerMessage,
    OutgoingClientMessage,
} from "shared-types";
import { useSyncClient } from "@bnk/sync-react";

export type GlobalSyncManagerConfig = SyncClientManagerConfig<IncomingServerMessage, OutgoingClientMessage>


/**
 * We'll store our chat log in React state. The server will send us 
 * either an `initial_state` or `state_update` message, 
 * each containing { messageLog: string[] } data.
 */
export function ChatSyncProvider({ children }: { children: React.ReactNode }) {
    const [messageLog, setMessageLog] = useState<string[]>([]);

    /**
     * This type ensures we only allow known message types:
     * "initial_state" | "state_update"
     */
    const messageHandlers: GlobalSyncManagerConfig['messageHandlers'] = useMemo(() => ({

        // On initial_state, the server provides the full ChatAppState
        initial_state: (msg) => {
            // msg is `Extract<IncomingServerMessage, { type: 'initial_state' }>`
            setMessageLog(msg.data.messageLog);
        },
        // On state_update, the server has appended new messages
        state_update: (msg) => {
            // msg is `Extract<IncomingServerMessage, { type: 'state_update' }>`
            setMessageLog(msg.data.messageLog);
        },
    }), []);


    // Our config object, passed to WebSocketClientProvider
    const wsConfig: GlobalSyncManagerConfig = {
        url: "ws://localhost:3007/ws",
        debug: true,
        messageHandlers,
        onOpen: () => {
            console.log("[Client] WebSocket opened!");
        },
        onClose: () => {
            console.log("[Client] WebSocket closed");
        },
        onError: (err) => {
            console.error("[Client] WebSocket error:", err);
        },
    };

    const { sendMessage, isOpen, disconnect, manager } = useSyncClient<IncomingServerMessage, OutgoingClientMessage>({ config: wsConfig });


    /**
     * For the client->server messages, we can define them below or inside other components.
     * Example: sending a new chat message of type = "chat".
     */
    return (
        <MessageLogContext.Provider value={{ messageLog, setMessageLog, sendMessage, isOpen, disconnect, manager }}>
            {children}
        </MessageLogContext.Provider>
    );
}

/**
 * Expose messageLog via context so children can read/update it easily.
 */
interface IMessageLogContext {
    messageLog: string[];
    setMessageLog: React.Dispatch<React.SetStateAction<string[]>>;
    sendMessage: (msg: OutgoingClientMessage) => void;
    isOpen: boolean;
    disconnect: () => void;
    manager: SyncClientManager<IncomingServerMessage, OutgoingClientMessage> | null
}
export const MessageLogContext = React.createContext<IMessageLogContext>({
    messageLog: [],
    setMessageLog: () => { },
    sendMessage: () => { },
    isOpen: false,
    disconnect: () => { },
    manager: null
});



export const useChatWebSocket = () => {
    const context = useContext(MessageLogContext);
    if (!context) {
        throw new Error("useChatWebSocket must be used within a ChatWebSocketProvider");
    }
    return context;
}