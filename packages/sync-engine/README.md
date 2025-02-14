# BNK's Backend Websocket manager

A pluggable, type-safe WebSocket manager for **Bun** servers. This library focuses on simplicity, modularity, and performance. It provides a clean, extensible API for handling real-time state and broadcast scenarios, with optional SQLite/file persistence and built-in or custom validation strategies.

---

## Quick Start

Below is the fastest way to get up and running. This minimal setup:

1. Defines a **state** for your application.
2. Defines a **message** type (for incrementing a counter).
3. Creates a **WebSocket manager** with an in-memory state.
4. Integrates with a Bun server to handle connections and messages.

### 1. Install

```bash
# Using Bun
bun add @bnk/sync-engine

# Or with npm/yarn
npm install @bnk/sync-engine
# yarn add @bnk/sync-engine
```

### 2. Define Your State and Message

**`my-types.ts`**:
```ts
import type { BaseMessage } from "@bnk/sync-engine";

export interface MyAppState {
  counter: number;
}

export interface IncrementMessage extends BaseMessage {
  type: "increment";
  amount: number;
}

export type MyAppMessage = IncrementMessage; // Or a union of multiple message types
```

### 3. Set Up a Handler

**`message-handlers.ts`**:
```ts
import type { MessageHandler } from "@bnk/sync-engine";
import type { MyAppState, MyAppMessage } from "./my-types";

export const incrementHandler: MessageHandler<MyAppState, MyAppMessage> = {
  type: "increment",
  async handle(ws, message, getState, setState) {
    const state = await getState();
    state.counter += message.amount;
    await setState(state);
  },
};

export const myHandlers = [incrementHandler];
```

### 4. Create the WebSocket Manager

**`manager-setup.ts`**:
```ts
import { SyncEngine } from "@bnk/sync-engine";
import { myHandlers } from "./message-handlers";
import type { MyAppState, MyAppMessage } from "./my-types";

const initialState: MyAppState = { counter: 0 };

export const mySyncManager = new SyncEngine<MyAppState, MyAppMessage>({
  initialState,
  messageHandlers: myHandlers,
  debug: true, // Enable verbose console logs
});
```

### 5. Integrate with Bun

**`bun-server.ts`**:
```ts
import { serve } from "bun";
import { mySyncManager } from "./manager-setup";

serve({
  port: 3000,
  fetch() {
    return new Response("Hello from Bun!", { status: 200 });
  },
  websocket: {
    open(ws) {
      mySyncManager.handleOpen(ws);
    },
    close(ws) {
      mySyncManager.handleClose(ws);
    },
    async message(ws, rawData) {
      // Process incoming messages
      await mySyncManager.handleMessage(ws, rawData.toString());

      // Broadcast the updated state to all clients
      await mySyncManager.broadcastState();
    },
  },
});

console.log("Server is running on http://localhost:3000");
```

### 6. Send a Message from the Client

```ts
const ws = new WebSocket("ws://localhost:3000");

ws.onopen = () => {
  // Increment the counter by 5
  ws.send(JSON.stringify({ type: "increment", amount: 5 }));
};

ws.onmessage = (event) => {
  console.log("Server message:", event.data);
};
```

---

## Validation Examples

You can validate incoming messages either manually or by using your preferred schema validation library. Simply supply a `validateMessage` function in the manager config.

### Manual Validation

```ts
import { SyncEngine } from "@bnk/sync-engine";
import { myHandlers } from "./message-handlers";
import type { MyAppState, MyAppMessage } from "./my-types";

function manualValidate(raw: unknown): MyAppMessage {
  if (
    typeof raw === "object" &&
    raw !== null &&
    (raw as any).type === "increment" &&
    typeof (raw as any).amount === "number"
  ) {
    return raw as MyAppMessage;
  }
  throw new Error("Invalid message format");
}

export const mySyncManager = new SyncEngine<MyAppState, MyAppMessage>({
  initialState: { counter: 0 },
  messageHandlers: myHandlers,
  validateMessage: (raw) => {
    const parsed = JSON.parse(String(raw));
    return manualValidate(parsed);
  },
});
```

### Using Zod

```ts
import { z } from "zod";
import { SyncEngine } from "@bnk/sync-engine";
import { myHandlers } from "./message-handlers";
import type { MyAppState, MyAppMessage } from "./my-types";

const incrementSchema = z.object({
  type: z.literal("increment"),
  amount: z.number(),
});

// If you have multiple message types, you can use z.discriminatedUnion(...)
const messageSchema = incrementSchema; // Example: single schema

export const mySyncManager = new SyncEngine<MyAppState, MyAppMessage>({
  initialState: { counter: 0 },
  messageHandlers: myHandlers,
  validateMessage: (raw) => {
    return messageSchema.parse(JSON.parse(String(raw))) as MyAppMessage;
  },
});
```

### Using Other Libraries (e.g., Yup, Joi)

```ts
import * as yup from "yup";
import { SyncEngine } from "@bnk/sync-engine";
import type { MyAppState, MyAppMessage } from "./my-types";

const incrementSchema = yup.object().shape({
  type: yup.string().oneOf(["increment"]).required(),
  amount: yup.number().required(),
});

function validateWithYup(raw: unknown): MyAppMessage {
  const parsed = JSON.parse(String(raw));
  return incrementSchema.validateSync(parsed) as MyAppMessage;
}

export const mySyncManager = new SyncEngine<MyAppState, MyAppMessage>({
  initialState: { counter: 0 },
  messageHandlers: [],
  validateMessage: validateWithYup,
});
```

---

## SQLite Persistence

If you need to persist state between restarts, you can use the built-in **`SQLiteWebSocketAdapter`**. It stores your entire state object and version number in a single SQLite table.

```ts
import { SyncEngine, SQLiteWebSocketAdapter } from "@bnk/sync-engine";
import type { MyAppState, MyAppMessage } from "./my-types";
import { myHandlers } from "./message-handlers";

const sqliteAdapter = new SQLiteWebSocketAdapter<MyAppState>({
  path: "my-database.sqlite", // Path to your SQLite file
  tableName: "my_custom_websocket_table", // Optional, defaults to "websocket_state"
});

export const mySyncManager = new SyncEngine<MyAppState, MyAppMessage>({
  initialState: { counter: 0 },
  messageHandlers: myHandlers,
  adapter: sqliteAdapter,
  enableVersioning: true, // Optionally increment version on each state update
  syncIntervalMs: 60000,  // Automatically persist state every 60 seconds
});
```

- On startup, the adapter creates a table (if it doesn’t exist).
- It loads the previously saved state/version into the manager.
- On each state update, `save()` is called, writing your data to SQLite.
- You can also manually call `mySyncManager.createBackup()` for a backup.

---

## File Persistence

Alternatively, a **`FileWebSocketAdapter`** is available to store state on the filesystem as JSON:

```ts
import { SyncEngine, FileWebSocketAdapter } from "@bnk/sync-engine";
import { myHandlers } from "./message-handlers";
import type { MyAppState, MyAppMessage } from "./my-types";

const fileAdapter = new FileWebSocketAdapter<MyAppState>({
  filePath: "./my-websocket-state.json",
  backupsDir: "./backups", // optional
});

export const mySyncManager = new SyncEngine<MyAppState, MyAppMessage>({
  initialState: { counter: 0 },
  messageHandlers: myHandlers,
  adapter: fileAdapter,
  enableVersioning: true,
});
```

---

## Configuration Overview

When creating a new `SyncEngine`, you can pass in various config options:

```ts
interface SyncEngineConfig<TState, TMessage> {
  // Initial in-memory state (if no adapter is used, or if adapter data is empty)
  initialState?: TState;

  // Array of message handlers { type, handle(...) }
  messageHandlers: Array<MessageHandler<TState, TMessage>>;

  // Debug flag for console logging
  debug?: boolean;

  // Lifecycle hooks (onConnect, onDisconnect, onStateChange, etc.)
  hooks?: SyncEngineHooks<TState>;

  // Interval for sending "ping" messages (ms). If 0 or undefined, heartbeat is disabled.
  heartbeatIntervalMs?: number;

  // Timeout waiting for "pong" before disconnecting (ms).
  pingTimeoutMs?: number;

  // Function/schema to validate raw messages. Expects returning a TMessage or throwing an error.
  validateMessage?: (rawMessage: unknown) => TMessage;

  // Persistence adapter for loading/saving state (e.g., SQLiteWebSocketAdapter or FileWebSocketAdapter).
  adapter?: BackendWebSocketPersistenceAdapter<TState>;

  // If true, automatically increments an internal version on each state update.
  enableVersioning?: boolean;

  // If set, automatically call manager.sync() at this interval in milliseconds.
  syncIntervalMs?: number;
}
```

---

## Testing

This library is designed to work seamlessly with **Bun’s built-in test runner**. You can mock out WebSocket connections, adapters, and hooks for unit tests. An example test suite is provided in the repository.

To run tests:

```bash
bun test
```

### Example Test Snippet

```ts
import { describe, it, expect } from "bun:test";
import { SyncEngine } from "@bnk/sync-engine";
import type { BaseMessage } from "@bnk/sync-engine";

interface TestState { counter: number }
interface IncrementMsg extends BaseMessage {
  type: "increment";
  amount: number;
}

describe("SyncEngine", () => {
  it("increments the state counter", async () => {
    const manager = new SyncEngine<TestState, IncrementMsg>({
      initialState: { counter: 0 },
      messageHandlers: [{
        type: "increment",
        handle: async (ws, message, getState, setState) => {
          const state = await getState();
          state.counter += message.amount;
          await setState(state);
        },
      }],
    });

    // Simulate a WebSocket message
    const mockWs = {} as any; // A partial mock for demonstration
    await manager.handleOpen(mockWs);
    await manager.handleMessage(mockWs, JSON.stringify({ type: "increment", amount: 5 }));

    expect(manager.getState().counter).toBe(5);
  });
});
```

---

## Contributing

Contributions of all kinds are welcome, whether it’s a bug report, new feature, or documentation improvement. Please open an issue or submit a pull request on GitHub. Make sure to:

- Write or update tests when adding new features.
- Follow the existing coding style (modern TypeScript, ES modules).

---

## License

This project is available under the [MIT License](./LICENSE).  
Enjoy building real-time applications with **sync-engine**!
```