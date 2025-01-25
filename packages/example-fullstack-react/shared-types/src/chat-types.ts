import { z } from "zod";

/**
 * 1) The overall state of our chat app
 */
export const ChatAppStateSchema = z.object({
    messageLog: z.array(z.string()),
});
export type ChatAppState = z.infer<typeof ChatAppStateSchema>;

/**
 * 2) The client->server messages. 
 *    Here, we define the chat payload and wrap it in a Zod schema.
 */
export const ChatClientMessageSchema = z.object({
    type: z.literal("chat"),
    payload: z.object({
        text: z.string().min(1),
        sender: z.string().min(1),
    }),
});

// In this simple demo, the only outgoing message is "chat"
export const OutgoingClientMessageSchema = ChatClientMessageSchema;
export type OutgoingClientMessage = z.infer<typeof OutgoingClientMessageSchema>;

/**
 * 3) The server->client messages.
 *    We have two: 'initial_state' and 'state_update'.
 */
export const InitialStateServerMessageSchema = z.object({
    type: z.literal("initial_state"),
    data: ChatAppStateSchema,
});

export const StateUpdateServerMessageSchema = z.object({
    type: z.literal("state_update"),
    data: ChatAppStateSchema,
});

/**
 * Union of all server->client message types
 */
export const IncomingServerMessageSchema = z.discriminatedUnion("type", [
    InitialStateServerMessageSchema,
    StateUpdateServerMessageSchema,
]);
export type IncomingServerMessage = z.infer<typeof IncomingServerMessageSchema>;