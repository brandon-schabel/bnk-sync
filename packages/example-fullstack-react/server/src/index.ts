import { serve } from "bun";
import {
    SyncEngine,
    type MessageHandler
} from "@bnk/sync-engine";

import {
    OutgoingClientMessageSchema,
    type ChatAppState,
    type OutgoingClientMessage,
} from "shared-types";


/**
 * Example "chat" message handler. We store incoming chat messages
 * in memory, but you could do DB writes, etc.
 */
const chatHandler: MessageHandler<ChatAppState, OutgoingClientMessage> = {
    type: "chat",
    async handle(ws, message, getState, setState) {
        const state = await getState();
        const newEntry = `${message.payload.sender}: ${message.payload.text}`;
        state.messageLog.push(newEntry);

        await setState(state);

        // Optionally broadcast the updated log to all connected clients:
        // manager.broadcastState();
    },
};

/**
 * In-memory state for demonstration. In production, you might use a DB.
 */
let currentState: ChatAppState = {
    messageLog: [],
};

/**
 * getState and setState for the manager config
 */
async function getState(): Promise<ChatAppState> {
    // Return a structured clone for immutability
    return structuredClone(currentState);
}

async function setState(newState: ChatAppState): Promise<void> {
    currentState = structuredClone(newState);
}

/**
 * Create the manager with a debug flag to see logs in the console.
 */
const manager = new SyncEngine<ChatAppState, OutgoingClientMessage>({
    initialState: await getState(),
    messageHandlers: [chatHandler],
    debug: true,
    validateMessage: (raw) => {
        if (typeof raw !== 'object' || raw === null) {
            throw new Error('Expected message to be an object');
        }
        return OutgoingClientMessageSchema.parse(raw);
    },
});

/**
 * Start the Bun server on port 3007.
 * Wire up the manager in the `websocket` config.
 */
serve({
    port: 3007,
    fetch(req, server) {
        const url = new URL(req.url);

        if (url.pathname === "/ws") {
            const upgraded = server.upgrade(req, {
                data: { someContext: "hello" },
            });
            return upgraded
                ? undefined
                : new Response("Failed to upgrade", { status: 400 });
        }


        return new Response("Hello from the Bun WebSocket demo server!", { status: 200 });
    },
    websocket: {
        open(ws) {
            manager.handleOpen(ws);
        },
        close(ws) {
            manager.handleClose(ws);
        },
        async message(ws, msg) {
            // msg is a Bun.Buffer; convert to string
            console.log("Before handleMessage:", currentState);
            await manager.handleMessage(ws, msg.toString());
            console.log("After handleMessage:", currentState);
            // Also broadcast updated state to all clients
            await manager.broadcastState();
        },
    },
});

console.log(`Server is running at http://localhost:3007`);