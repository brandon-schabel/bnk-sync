# @bnk/client-websocket-manager

A lightweight, **type-safe**, and **highly pluggable** WebSocket client manager for **Bun** and JavaScript/TypeScript applications. This library provides an intuitive API and advanced TypeScript definitions to make working with client-side WebSocket connections simple, robust, and performant.

---

## Table of Contents

1. [Introduction](#introduction)  
2. [Installation](#installation)  
3. [Usage Examples](#usage-examples)  
   - [Basic Setup (TypeScript)](#basic-setup-typescript)  
   - [Integration with a Backend Manager](#integration-with-a-backend-manager)  
   - [Using in a Plain JavaScript Client](#using-in-a-plain-javascript-client)  
4. [API Documentation](#api-documentation)  
   - [Interfaces](#interfaces)  
   - [Classes](#classes)  
5. [Message Validation](#message-validation)  
6. [Performance Notes](#performance-notes)  
7. [Configuration & Customization](#configuration--customization)  
8. [Testing](#testing)  
9. [Contributing](#contributing)  
10. [License](#license)

---

## Introduction

The **@bnk/client-websocket-manager** library focuses on:

- **Type safety**: Strongly typed incoming and outgoing messages.
- **Performance**: Leverages native WebSockets and Bun for efficiency.
- **Plug-and-Play Modularity**: Highly extensible via message handlers, minimal dependencies.
- **Zero or Minimal External Dependencies**: No heavy overhead—easy to audit and maintain.

Use it in any TypeScript or JavaScript environment (including React or Vanilla JS) to manage WebSocket connections without fuss.

---

## Installation

### Using Bun

```bash
bun add @bnk/client-websocket-manager
```

### Using npm

```bash
npm install @bnk/client-websocket-manager
```

### Using Yarn

```bash
yarn add @bnk/client-websocket-manager
```

---

## Usage Examples

### Basic Setup (TypeScript)

Below is a minimal example showing how to set up a client WebSocket connection in a TypeScript project. The manager will connect to the specified `url`, listen for messages, and forward them to registered handlers.

```ts
import {
  ClientWebSocketManager,
  type BaseServerMessage,
  type BaseClientMessage,
} from "@bnk/client-websocket-manager";

// Define your server->client message types
interface MyServerMessage extends BaseServerMessage {
  type: "welcome" | "counter_update" | "other_event";
  data?: {
    // your custom data
    counter?: number;
    message?: string;
  };
}

// Define your client->server message types
interface MyClientMessage extends BaseClientMessage {
  type: "increment" | "hello_server";
  // optionally include more data
  amount?: number;
}

const manager = new ClientWebSocketManager<MyServerMessage, MyClientMessage>({
  url: "ws://localhost:3007",
  debug: true, // enable debug logs for development
  onOpen: () => {
    console.log("WebSocket connected!");
    // Example of sending a message to the server
    manager.sendMessage({ type: "hello_server" });
  },
  onClose: (event) => {
    console.log("WebSocket closed", event.reason);
  },
  onError: (event) => {
    console.error("WebSocket error", event);
  },
  messageHandlers: {
    welcome: (msg) => {
      console.log("Received welcome message:", msg.data?.message);
    },
    counter_update: (msg) => {
      console.log("Counter updated to:", msg.data?.counter);
    },
    other_event: (msg) => {
      console.log("Other event:", msg.data);
    },
  },
});

// When appropriate, you can gracefully disconnect:
// manager.disconnect();
```

### Integration with a Backend Manager

In many scenarios, you'll pair this client with a server-side manager (for instance, the **@bnk/backend-websocket-manager**). Below is a simplified illustration of how that might look:

**Server (TypeScript/Bun)**:

```ts
import { serve } from "bun";
import {
  BackendWebSocketManager,
  type BaseMessage,
  type MessageHandler,
} from "@bnk/backend-websocket-manager";

// Example state
interface MyServerState {
  counter: number;
}

// Example message union
interface IncrementMessage extends BaseMessage {
  type: "increment";
  amount: number;
}

interface PingMessage extends BaseMessage {
  type: "ping";
}

type MyServerMessage = IncrementMessage | PingMessage;

// Create manager with handlers
const manager = new BackendWebSocketManager<MyServerState, MyServerMessage>({
  getState: async () => ({ counter: 0 }),
  setState: async (newState) => {
    // persist newState somewhere (in-memory, DB, etc.)
  },
  messageHandlers: [
    {
      type: "increment",
      handle: async (ws, message, getState, setState) => {
        const state = await getState();
        const updated = { ...state, counter: state.counter + message.amount };
        await setState(updated);
        // Optionally broadcast state to all clients
        await manager.broadcastState();
      },
    },
    {
      type: "ping",
      handle: async (ws) => {
        ws.send(JSON.stringify({ type: "pong" }));
      },
    },
  ],
});

// Use Bun.serve to handle upgrade to WebSockets
serve({
  port: 3007,
  fetch(request, server) {
    if (server.upgrade(request, {})) {
      return; // Return nothing if upgrade is successful
    }
    return new Response("Not a WebSocket request.");
  },
  websocket: {
    open: (ws) => manager.handleOpen(ws),
    message: (ws, message) => manager.handleMessage(ws, message),
    close: (ws) => manager.handleClose(ws),
  },
});
```

**Client (using @bnk/client-websocket-manager)**:

```ts
import {
  ClientWebSocketManager,
} from "@bnk/client-websocket-manager";

const manager = new ClientWebSocketManager({
  url: "ws://localhost:3007",
  debug: true,
  messageHandlers: {
    initial_state: (msg) => {
      console.log("Received initial state:", msg.data);
    },
    state_update: (msg) => {
      console.log("Received state update:", msg.data);
    },
  },
});

// Send an "increment" message to server
manager.sendMessage({ type: "increment", amount: 5 });
```

### Using in a Plain JavaScript Client

Even though this library is written in TypeScript, you can still use it in a traditional JavaScript setup. Just skip the type annotations:

```js
import { ClientWebSocketManager } from "@bnk/client-websocket-manager";

const manager = new ClientWebSocketManager({
  url: "ws://localhost:3007",
  debug: false,
  messageHandlers: {
    welcome: (msg) => {
      console.log("Received welcome:", msg);
    },
    // ...other handlers
  },
});

// Send a simple message
manager.sendMessage({ type: "hello_server" });
```

---

## API Documentation

### Interfaces

#### `ClientWebSocketManagerConfig<TIncoming, TOutgoing>`

- **`url: string`** – The WebSocket endpoint to connect to.
- **`debug?: boolean`** – Enable debug logs (optional).
- **`onOpen?: () => void`** – Called when the socket opens.
- **`onClose?: (event: CloseEvent) => void`** – Called when the socket closes.
- **`onError?: (event: Event) => void`** – Called on socket error.
- **`messageHandlers?: { [K in TIncoming["type"]]?: (msg: Extract<TIncoming, { type: K }>) => void }`**  
  A map of handlers keyed by `message.type`.

#### `BaseClientMessage`

- **`type: string`** – Identifies the message type being sent to the server.

#### `BaseServerMessage`

- **`type: string`** – Identifies the message type received from the server.
- **`data?: unknown`** – Optional payload.

### Classes

#### `ClientWebSocketManager<TIncoming, TOutgoing>`

This class manages a single WebSocket connection, provides lifecycle hooks, and handles message dispatch:

- **Constructor**  

  ```ts
  constructor(config: ClientWebSocketManagerConfig<TIncoming, TOutgoing>)
  ```

- **`disconnect(): void`**  
  Gracefully closes the WebSocket if open.
- **`sendMessage(msg: TOutgoing): void`**  
  Sends a strongly typed message to the server.
- **Private/Callback Methods**: `handleOpen`, `handleClose`, `handleError`, `handleMessage` (not typically called directly).

---

## Message Validation

The ClientWebSocketManager supports robust message validation for both incoming and outgoing messages. For best practices, we recommend sharing validation schemas between client and server using a shared package in your workspace.

### Shared Type Validation (Recommended)

#### Using [Bun WorkSpace](https://bun.sh/docs/install/workspaces)

The best approach is to maintain your types and validation schemas in a shared package that both client and server can import. Here's how to structure it:

```bash
your-project/
├── packages/
│   ├── shared-types/        # Shared type definitions and schemas
│   ├── client/             # Your client application
│   └── server/             # Your server application
```

#### 1. Define Shared Types

First, create your shared types package (e.g., `shared-types/src/chat-types.ts`):

```ts
import { z } from "zod";

// 1. Define your app state
export const ChatAppStateSchema = z.object({
    messageLog: z.array(z.string()),
});
export type ChatAppState = z.infer<typeof ChatAppStateSchema>;

// 2. Client->Server messages
export const ChatClientMessageSchema = z.object({
    type: z.literal("chat"),
    payload: z.object({
        text: z.string().min(1),
        sender: z.string().min(1),
    }),
});

export const OutgoingClientMessageSchema = ChatClientMessageSchema;
export type OutgoingClientMessage = z.infer<typeof OutgoingClientMessageSchema>;

// 3. Server->Client messages
export const InitialStateServerMessageSchema = z.object({
    type: z.literal("initial_state"),
    data: ChatAppStateSchema,
});

export const StateUpdateServerMessageSchema = z.object({
    type: z.literal("state_update"),
    data: ChatAppStateSchema,
});

export const IncomingServerMessageSchema = z.discriminatedUnion("type", [
    InitialStateServerMessageSchema,
    StateUpdateServerMessageSchema,
]);
export type IncomingServerMessage = z.infer<typeof IncomingServerMessageSchema>;
```

#### 2. Use in Client

Then use these shared types in your client:

```ts
import {
    type IncomingServerMessage,
    type OutgoingClientMessage,
    IncomingServerMessageSchema,
    OutgoingClientMessageSchema,
} from "@your-org/shared-types";
import { ClientWebSocketManager } from "@bnk/client-websocket-manager";

const manager = new ClientWebSocketManager<IncomingServerMessage, OutgoingClientMessage>({
    url: "ws://localhost:3007",
    debug: true,
    // Use shared validation schemas
    validateIncomingMessage: (raw) => IncomingServerMessageSchema.parse(raw),
    validateOutgoingMessage: (msg) => OutgoingClientMessageSchema.parse(msg),
    messageHandlers: {
        initial_state: (msg) => {
            // TypeScript knows msg.data is ChatAppState
            console.log("Message log:", msg.data.messageLog);
        },
        state_update: (msg) => {
            // Full type safety and runtime validation
            updateUI(msg.data);
        },
    },
});

// Type-safe message sending
manager.sendMessage({
    type: "chat",
    payload: {
        text: "Hello!",
        sender: "Alice",
    },
});
```

#### 3. Use in Server

And in your server:

```ts
import {
    type ChatAppState,
    type OutgoingClientMessage,
    ChatAppStateSchema,
    OutgoingClientMessageSchema,
} from "@your-org/shared-types";
import { BackendWebSocketManager } from "@bnk/backend-websocket-manager";

const manager = new BackendWebSocketManager<ChatAppState, OutgoingClientMessage>({
    validateMessage: (msg) => OutgoingClientMessageSchema.parse(msg),
    validateState: (state) => ChatAppStateSchema.parse(state),
    // ... rest of your config
});
```

### Benefits of Shared Validation

1. **Single Source of Truth**: Types and validation logic are defined once and shared
2. **Type Safety**: Automatic TypeScript errors if messages don't match schemas
3. **Runtime Validation**: Same validation rules on both client and server
4. **DRY Code**: No duplication of type definitions or validation logic
5. **Better Maintainability**: Change types in one place, affects both sides
6. **API Documentation**: Schemas serve as living documentation

### Setting Up Shared Types Package

1. Create the package:

```bash
mkdir -p packages/shared-types
cd packages/shared-types
bun init
```

2. Add to your workspace in root `package.json`:

```json
{
  "workspaces": [
    "packages/*"
  ]
}
```

3. Install in other packages:

```bash
# In client/server packages
bun add @your-org/shared-types@workspace:*
```

### Best Practices

1. **Version Control**: Keep shared types versioned with your application
2. **Breaking Changes**: Treat type changes as breaking changes
3. **Testing**: Include tests for your shared validation logic
4. **Documentation**: Document your message types and validation rules
5. **Strict Mode**: Use TypeScript's strict mode for better type safety

---

## Performance Notes

- Uses the native `WebSocket` interface directly—no external dependencies for WebSocket management.
- **Bun** is extremely fast at I/O operations, so the overhead is primarily just JSON parsing/stringification.
- Debug logs (`debug: true`) can be enabled during development but should typically be disabled in production to reduce console overhead.

---

## Configuration & Customization

- **Message Handlers**: Add or remove handlers in `messageHandlers` to extend or limit what your client responds to.
- **Reconnection Logic**: If you want to implement automatic reconnection, you can do it inside `onClose`. For example:

```ts
onClose: (event) => {
  if (shouldReconnect) {
    setTimeout(() => {
      new ClientWebSocketManager(config);
    }, 1000);
  }
}
```

- **Type Extensions**: Extend the provided `BaseClientMessage` and `BaseServerMessage` interfaces or create your own. Then define them as `TOutgoing`/`TIncoming` generics in the manager config for strict type checking.

---

## Testing

We recommend using **Bun's built-in test suite**. A typical command:

```bash
bun test
```

Given our modular design, you can:

- Test message handlers in isolation (unit tests).
- Test full integration by spinning up a test WebSocket server and verifying behavior end-to-end.
- Mock or spy on `onOpen`, `onClose`, etc. to verify lifecycle calls.

All code in this repository is designed to be straightforward to test due to its **modular**, **functional** approach.

---

## Contributing

Contributions are welcome! To contribute:

1. **Fork** the repo and create a new branch.
2. **Implement** your feature or bug fix with tests where possible.
3. Run `bun test` to ensure all tests pass.
4. Submit a **pull request** with a clear description of your changes.

Please maintain the existing code style and include tests for new or modified functionality.

---

## License

This project is licensed under the **MIT License**. See the [LICENSE](./LICENSE) file for details.

---

_**Why this structure?** Providing separate sections for **Usage**, **API** docs, and **Configuration** ensures clarity and maintainability. Readers can quickly find the details they need without hunting through large code blocks._

Enjoy using **@bnk/client-websocket-manager** for robust, type-safe WebSocket connections in your Bun or JS/TS applications!
