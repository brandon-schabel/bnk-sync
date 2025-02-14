# **BNK Sync Engine**

A **pluggable**, **type-safe**, and **performance-focused** suite of TypeScript libraries built on **Bun** for syncing server and client using websockets. BNK Sync Engine is split into three main packages, each addressing a different part of a real-time stack:

- [`@bnk/sync-engine`](#bnksync-engine) – Server-side WebSocket manager for Bun.  
- [`@bnk/sync-client`](#bnksync-client) – Client-side WebSocket manager for browsers (or other WebSocket environments).  
- [`@bnk/sync-react`](#bnksync-react) – React-specific hooks and components for WebSocket integration.

All packages prioritize **type safety**, **minimal dependencies**, and a **pluggable architecture** for easy customization.

---

## **Table of Contents**

1. [Introduction](#introduction)  
2. [Installation](#installation)  
3. [Quick Start](#quick-start)  
   - [Server Example](#server-example)  
   - [Client Example (Vanilla)](#client-example-vanilla)  
   - [React Example](#react-example)  
4. [Type Validation](#type-validation)  
   - [Manual Validation](#manual-validation)  
   - [Using Zod](#using-zod)  
5. [Recommended Approach](#recommended-approach)  
6. [Advanced Usage](#advanced-usage)  
   - [Persistence (SQLite)](#persistence-sqlite)  
   - [Persistence (File)](#persistence-file)  
   - [Broadcasting State](#broadcasting-state)  
   - [Hooks & Middleware](#hooks--middleware)  
7. [Testing](#testing)  
8. [Contributing](#contributing)  
9. [License](#license)

---

## **Introduction**

**BNK Sync Engine** aims to simplify building real-time applications in **Bun** by offering:

- **High Performance**: Built on Bun’s native WebSocket.  
- **Type Safety**: Written in TypeScript, with generics and advanced typing to ensure confidence in your code.  
- **Modular & Composable**: Each package can be used independently or combined for a fullstack approach.  
- **Minimal Dependencies**: Minimizes or eliminates external dependencies for speed and smaller bundles.  
- **Pluggability**: Support for custom message handlers, validation, hooks, and optional persistence (SQLite or file-based).  

Whether you’re building a small chat app or a robust real-time platform, BNK Sync Engine provides sensible defaults and straightforward extensibility.

---

## **Installation**

Using **Bun** (recommended):

```bash
bun add @bnk/sync-engine
bun add @bnk/sync-client
bun add @bnk/sync-react
```

---

## **Quick Start**

Below are minimal examples for each package. For more detailed usage, see the [Advanced Usage](#advanced-usage) section.

### **Server Example**

A simple Bun server using **`@bnk/sync-engine`**:

```ts
import { serve } from "bun";
import {
  SyncEngine,
  type MessageHandler,
  type BaseMessage,
} from "@bnk/sync-engine";

interface MyAppState {
  counter: number;
}

interface IncrementMessage extends BaseMessage {
  type: "increment";
  amount: number;
}

const incrementHandler: MessageHandler<MyAppState, IncrementMessage> = {
  type: "increment",
  async handle(ws, message, getState, setState) {
    const state = await getState();
    state.counter += message.amount;
    await setState(state);
  },
};

let currentState: MyAppState = { counter: 0 };

async function getState(): Promise<MyAppState> {
  // Return a structured clone for immutability or read from DB
  return structuredClone(currentState);
}

async function setState(newState: MyAppState): Promise<void> {
  currentState = structuredClone(newState);
}

const manager = new SyncEngine<MyAppState, IncrementMessage>({
  initialState: await getState(),
  messageHandlers: [incrementHandler],
  debug: true,
});

serve({
  port: 3000,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      return server.upgrade(req);
    }
    return new Response("Hello from Bun!");
  },
  websocket: {
    open(ws) {
      manager.handleOpen(ws);
    },
    close(ws) {
      manager.handleClose(ws);
    },
    async message(ws, msg) {
      await manager.handleMessage(ws, msg.toString());
      // Broadcast updated state to all clients
      await manager.broadcastState();
    },
  },
});

console.log("Server running at http://localhost:3000");
```

### **Client Example (Vanilla)**

A minimal Sync client using **`@bnk/sync-client`** in the browser (or any JS runtime with WebSocket):

```ts
import {
  SyncClientManager,
  type BaseServerMessage,
  type BaseClientMessage,
} from "@bnk/sync-client";

interface IncomingServerMessage extends BaseServerMessage {
  type: "state_update";
  data: { counter: number };
}

interface OutgoingClientMessage extends BaseClientMessage {
  type: "increment";
  amount: number;
}

const clientManager = new SyncClientManager<
  IncomingServerMessage,
  OutgoingClientMessage
>({
  url: "ws://localhost:3000/ws",
  debug: true,
  messageHandlers: {
    state_update: (msg) => {
      console.log("New counter value:", msg.data.counter);
    },
  },
});

// Send a message to increment the counter by 5
clientManager.sendMessage({ type: "increment", amount: 5 });
```

### **React Example**

A simple React component using **`@bnk/sync-react`**:

```tsx
import React from "react";
import { useSyncClient } from "@bnk/sync-react";
import type { BaseClientMessage, BaseServerMessage } from "@bnk/sync-client";

interface OutgoingMessage extends BaseClientMessage {
  type: "increment";
  amount: number;
}

interface IncomingMessage extends BaseServerMessage {
  type: "state_update";
  data: { counter: number };
}

export function Counter() {
  const { isOpen, sendMessage } = useSyncClient<IncomingMessage, OutgoingMessage>({
    config: {
      url: "ws://localhost:3000/ws",
      debug: true,
      messageHandlers: {
        state_update: (msg) => {
          console.log("Updated counter:", msg.data.counter);
        },
      },
    },
  });

  const handleIncrement = () => {
    if (!isOpen) {
      console.warn("WebSocket is not open!");
      return;
    }
    sendMessage({ type: "increment", amount: 1 });
  };

  return (
    <div>
      <p>WebSocket status: {isOpen ? "OPEN" : "CLOSED"}</p>
      <button onClick={handleIncrement}>Increment</button>
    </div>
  );
}
```

---

## **Type Validation**

All three packages let you define a **validation** step for incoming (and optionally outgoing) messages. This ensures the server or client only processes messages that match your expected schema.

### **Manual Validation**

You can manually inspect the data in a custom function:

```ts
function validateIncrement(raw: unknown): IncrementMessage {
  const parsed = JSON.parse(String(raw));
  if (typeof parsed === "object" && parsed !== null) {
    if ((parsed as any).type === "increment" && typeof (parsed as any).amount === "number") {
      return parsed as IncrementMessage;
    }
  }
  throw new Error("Invalid message format");
}

// Then pass `validateMessage` in the manager config:
const manager = new SyncEngine<MyAppState, IncrementMessage>({
  initialState: { counter: 0 },
  messageHandlers: [incrementHandler],
  validateMessage: (raw) => validateIncrement(raw),
});
```

### **Using Zod**

A more robust approach uses [Zod](https://github.com/colinhacks/zod) for schema validation:

```ts
import { z } from "zod";

const IncrementSchema = z.object({
  type: z.literal("increment"),
  amount: z.number(),
});

export type IncrementMessage = z.infer<typeof IncrementSchema>;

// Pass it in:
const manager = new SyncEngine<MyAppState, IncrementMessage>({
  initialState: { counter: 0 },
  messageHandlers: [incrementHandler],
  validateMessage: (raw) => {
    return IncrementSchema.parse(JSON.parse(String(raw)));
  },
});
```

---

## **Recommended Approach**

1. **Define your application state** (e.g., chat logs, counters, etc.) in a shared TypeScript type or a Zod schema.  
2. **Define your message types** similarly (possibly a union of multiple message variants).  
3. **Use `validateMessage`** on the server for robust sanity checks.  
4. Optionally, **validate outgoing messages** on the client by providing `validateOutgoingMessage` in the `SyncClientManager` config.  
5. For React, **wrap everything** in a provider or use the `useSyncClient` hook for streamlined subscription to WebSocket events.

---

## **Advanced Usage**

### **Persistence (SQLite)**

You can use built-in adapters to **persist your state** in SQLite. This ensures data survives server restarts:

```ts
import { SyncEngine, SQLiteSyncAdapter } from "@bnk/sync-engine";

const sqliteAdapter = new SQLiteSyncAdapter<MyAppState>({
  path: "my-sync.sqlite",
  tableName: "my_sync_table",
});

const manager = new SyncEngine<MyAppState, IncrementMessage>({
  initialState: { counter: 0 },
  messageHandlers: [incrementHandler],
  adapter: sqliteAdapter,
  enableVersioning: true,  // increments an internal version on each update
  syncIntervalMs: 60000,   // auto-sync to SQLite every 60s
});
```

### **Persistence (File)**

Alternatively, store state in a JSON file:

```ts
import { SyncEngine, SQLiteSyncAdapter } from "@bnk/sync-engine";

const fileAdapter = new SQLiteSyncAdapter<MyAppState>({
  filePath: "./websocket-state.json",
  backupsDir: "./backups",  // optional
});

const manager = new SyncEngine<MyAppState, IncrementMessage>({
  initialState: { counter: 0 },
  messageHandlers: [incrementHandler],
  adapter: fileAdapter,
  enableVersioning: true,
});
```

### **Broadcasting State**

Use `manager.broadcastState()` to send the updated application state to **all connected clients**:

```ts
await manager.broadcastState();
```

By default, it sends a message of the shape:

```json
{
  "type": "state_update",
  "data": { ... }
}
```

You can also send custom messages to specific clients by calling `ws.send()` inside your handlers.

### **Hooks & Middleware**

**Hooks** let you run custom logic on events like `onConnect`, `onDisconnect`, `onStateChange`, or `onSync`.  
**Middleware** can preprocess incoming messages before handling.  

Example hooking into `onConnect`:

```ts
const manager = new SyncEngine<MyAppState, MyMessage>({
  messageHandlers,
  hooks: {
    onConnect: async (ws) => {
      console.log("[Server] New client connected!", ws.data);
    },
  },
});
```

---

## **Testing**

All packages are designed for use with **Bun’s built-in test runner**:

```bash
bun test
```

A typical test might look like:

```ts
import { describe, it, expect } from "bun:test";
import { SyncEngine } from "@bnk/sync-engine";

describe("SyncEngine", () => {
  it("handles increment messages correctly", async () => {
    // ...
    expect( /* ... */ ).toBeTruthy();
  });
});
```

For React, use your preferred React testing library (e.g. React Testing Library or Enzyme) alongside Bun’s runner.

---

## **Contributing**

1. **Fork** and **clone** this repository.  
2. Create a **feature branch** from `main`.  
3. **Implement** and **test** your changes.  
4. Submit a **pull request** with a clear description of your additions.  

All contributions—bug fixes, features, docs—are welcome.

---

## **License**

**BNK Sync Engine** is licensed under the [MIT License](./LICENSE). Feel free to use, modify, and distribute it in your own projects. If you find it useful or have suggestions, please open an issue or submit a pull request. Happy coding with **Bun**!
