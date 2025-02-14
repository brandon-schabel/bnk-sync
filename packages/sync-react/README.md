# **@bnk/sync-react**

A modern, type-safe, and performant React WebSocket interface built entirely on Bun. This library streamlines WebSocket integration in React applications, providing **pluggable** and **composable** APIs with zero external dependencies besides React. Leverage the power of Bun’s native WebSocket performance while enjoying a fully typed, developer-friendly experience.

---

## **Table of Contents**

1. [Introduction](#introduction)  
2. [Installation](#installation)  
3. [Usage Examples](#usage-examples)  
   - [Basic React Usage](#basic-react-usage)  
   - [Using the Provided Hook](#using-the-provided-hook)  
   - [Fullstack Integration With @bnk/sync-engine](#fullstack-integration-with-bnksync-engine)  
4. [API Documentation](#api-documentation)  
   - [Types](#types)  
   - [SyncClientManager](#SyncClientManager)  
   - [useClientWebSocket](#useclientwebsocket)  
5. [Performance Notes](#performance-notes)  
6. [Configuration & Customization](#configuration--customization)  
7. [Testing](#testing)  
8. [Contributing](#contributing)  
9. [License](#license)

---

## **Introduction**

`@bnk/sync-react` is a React-specific wrapper around the core client WebSocket logic from [`@bnk/sync-client`](https://www.npmjs.com/package/@bnk/sync-client). Its primary goal is to:

- Provide a **modern**, **type-safe** interface for WebSockets in React applications.  
- Deliver **high performance** by leveraging **Bun**’s native WebSocket.  
- Encourage **plug-and-play modularity** through composable hooks and providers.  
- Offer **minimal** external dependencies (none besides React).  
- Ensure an ergonomic developer experience, with advanced TypeScript usage (generics, mapped types, intersection types, etc.).

This library pairs seamlessly with [`@bnk/sync-engine`](https://www.npmjs.com/package/@bnk/sync-engine) on the backend, letting you build a complete fullstack WebSocket solution in a type-safe manner.

---

## **Installation**

Using Bun:

```bash
bun add @bnk/sync-react
```

Using npm:

```bash
npm install @bnk/sync-react
```

Using yarn:

```bash
yarn add @bnk/sync-react
```

---

## **Usage Examples**

### **Basic React Usage**

Below is a minimal setup in a React application. This example assumes you have a WebSocket server running at `ws://localhost:3007/ws` built on Bun.

```tsx
import React from "react";
import { useClientWebSocket } from "@bnk/sync-react";

function App() {
  const { isOpen, sendMessage } = useClientWebSocket({
    config: {
      url: "ws://localhost:3007/ws",
      debug: true,
      onOpen: () => console.log("WebSocket opened!"),
      onClose: () => console.log("WebSocket closed."),
      messageHandlers: {
        // Handle incoming server messages here
        initial_state: (msg) => {
          console.log("Received initial state:", msg.data);
        },
        state_update: (msg) => {
          console.log("Updated state from server:", msg.data);
        },
      },
    },
  });

  const handleSend = () => {
    if (!isOpen) {
      console.warn("Socket is not open, cannot send message.");
      return;
    }
    sendMessage({
      type: "chat",
      payload: {
        text: "Hello from the client!",
        sender: "ReactUser",
      },
    });
  };

  return (
    <div>
      <h1>React WebSocket Manager Example</h1>
      <p>Connection status: {isOpen ? "Open" : "Closed"}</p>
      <button onClick={handleSend}>Send Chat Message</button>
    </div>
  );
}

export default App;
```

### **Using the Provided Hook**

The main hook is `useClientWebSocket`. It sets up a WebSocket manager internally and returns:

- `isOpen` – A boolean indicating if the WebSocket is currently open.  
- `sendMessage` – A function to send typed messages to the server.  
- `disconnect` – A function to gracefully close the WebSocket.  
- `manager` – The underlying `SyncClientManager` instance, if needed for advanced usage.

**Example With an Existing Manager**  
If you already have a `SyncClientManager` instance (for instance, if you create it elsewhere and want to pass it down), you can just inject it:

```tsx
import React, { useState } from "react";
import {
  SyncClientManager,
  type BaseServerMessage,
  type BaseClientMessage,
} from "@bnk/sync-client";
import { useClientWebSocket } from "@bnk/sync-react";

const existingManager = new SyncClientManager<BaseServerMessage, BaseClientMessage>({
  url: "ws://localhost:3007/ws",
  debug: true,
  onOpen: () => console.log("Existing Manager Open"),
});

function MyComponent() {
  const { isOpen, sendMessage } = useClientWebSocket({
    manager: existingManager,
  });

  const handleSend = () => {
    if (isOpen) {
      sendMessage({ type: "ping" });
    }
  };

  return (
    <div>
      <h2>Using an existing manager</h2>
      <p>Connection: {isOpen ? "Open" : "Closed"}</p>
      <button onClick={handleSend}>Send Ping</button>
    </div>
  );
}

export default MyComponent;
```

### **Fullstack Integration With `@bnk/sync-engine`**

Below is an outline demonstrating how you might integrate the React library on the frontend with the Bun-based WebSocket manager on the backend.

#### Backend (Bun + `@bnk/sync-engine`)

```ts
// server.ts
import { serve } from "bun";
import {
  SyncEngine,
  type BaseMessage,
  type MessageHandler
} from "@bnk/sync-engine";

// Example state and message definitions
interface MyState {
  messages: string[];
}

interface ChatMessage extends BaseMessage {
  type: "chat";
  payload: { sender: string; text: string };
}

const chatHandler: MessageHandler<MyState, ChatMessage> = {
  type: "chat",
  async handle(ws, message, getState, setState) {
    const state = await getState();
    state.messages.push(`${message.payload.sender}: ${message.payload.text}`);
    await setState(state);
  },
};

let currentState: MyState = { messages: [] };

async function getState(): Promise<MyState> {
  return structuredClone(currentState);
}

async function setState(newState: MyState): Promise<void> {
  currentState = structuredClone(newState);
}

const manager = new SyncEngine<MyState, ChatMessage>({
  getState,
  setState,
  messageHandlers: [chatHandler],
  debug: true,
});

serve({
  port: 3007,
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
      // Optionally broadcast new state to all clients
      await manager.broadcastState();
    },
  },
});
```

#### Frontend (React + `@bnk/sync-react`)

```tsx
// App.tsx
import React from "react";
import { useClientWebSocket } from "@bnk/sync-react";

function App() {
  const { isOpen, sendMessage } = useClientWebSocket({
    config: {
      url: "ws://localhost:3007/ws",
      debug: true,
      messageHandlers: {
        initial_state: (msg) => {
          console.log("Initial data:", msg.data);
        },
        state_update: (msg) => {
          console.log("Updated data:", msg.data);
        },
      },
    },
  });

  const handleChatSend = () => {
    if (!isOpen) {
      console.warn("Cannot send chat, socket is not open.");
      return;
    }
    sendMessage({
      type: "chat",
      payload: {
        text: "Hello from React!",
        sender: "ReactUser",
      },
    });
  };

  return (
    <div>
      <h1>Fullstack Bun WebSocket Example</h1>
      <p>Status: {isOpen ? "Connected" : "Disconnected"}</p>
      <button onClick={handleChatSend}>Send Chat</button>
    </div>
  );
}

export default App;
```

---

## **API Documentation**

### **Types**

```ts
export interface BaseClientMessage {
  type: string;
  // Optionally extend with more fields...
}

export interface BaseServerMessage {
  type: string;
  data?: unknown;
  // Optionally extend with more fields...
}
```

### **`SyncClientManager`**

A generic class that manages a single WebSocket connection client-side. It handles:

1. **Connection logic** (open, close, reconnect).  
2. **Sending typed messages** with `sendMessage()`.  
3. **Processing server messages** via a `messageHandlers` map.  

**Constructor**  

```ts
constructor(config: SyncClientManagerConfig<TIncoming, TOutgoing>)
```

| Parameter | Description |
| --- | --- |
| `config.url` | The WebSocket URL. e.g., `ws://localhost:3007/ws` |
| `config.debug?` | If `true`, enables verbose console logs. |
| `config.onOpen?` | Called when the connection opens. |
| `config.onClose?` | Called when the connection closes. |
| `config.onError?` | Called when an error occurs. |
| `config.messageHandlers?` | A mapping from `message.type` to a handler function. |

**Example**  

```ts
const manager = new SyncClientManager({
  url: "ws://localhost:3007/ws",
  debug: true,
  messageHandlers: {
    state_update: (msg) => {
      console.log("Server updated state:", msg.data);
    },
  },
});
```

### **`useClientWebSocket`**

A React hook that abstracts the `SyncClientManager`. Returns a simple interface to send messages and track connection state in React.

```ts
function useClientWebSocket<TIncoming extends BaseServerMessage, TOutgoing extends BaseClientMessage>(
  config: UseClientWebSocketConfig<TIncoming, TOutgoing>
): {
  manager: SyncClientManager<TIncoming, TOutgoing> | null;
  isOpen: boolean;
  sendMessage: (msg: TOutgoing) => void;
  disconnect: () => void;
}
```

| Return Key        | Description                                                        |
| ----------------- | ------------------------------------------------------------------ |
| `manager`         | The internal `SyncClientManager` instance.                    |
| `isOpen`          | A `boolean` indicating if the WebSocket is connected (OPEN).       |
| `sendMessage`     | A function to send typed messages to the server.                   |
| `disconnect`      | A function to gracefully disconnect the WebSocket.                |

---

## **Performance Notes**

- Built to leverage **Bun’s** native WebSocket performance—no extra overhead.  
- Uses modern TypeScript features (generics, mapped types) to enforce compile-time correctness while keeping runtime overhead minimal.  
- No additional dependencies besides React, ensuring a smaller overall bundle.

---

## **Configuration & Customization**

- Pass a **`debug`** flag to enable logging.  
- Provide your own `messageHandlers` to gracefully process server messages by **type**.  
- If you have multiple WebSockets or special domain logic, you can **reuse** the `SyncClientManager` instance and pass it to `useClientWebSocket`.

---

## **Testing**

Testing with Bun is straightforward—this project is structured to make each part independently testable. Here’s how you could run tests in your own environment:

```bash
bun test
```

If you need watch mode:

```bash
bun test --watch
```

You can easily write tests for your React components, such as verifying that the hook updates `isOpen` as expected or that messages are sent. Tools like [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/) can be used alongside Bun’s built-in test runner.

---

## **Contributing**

Contributions are welcome! Please:

1. **Fork** the repository and create a new branch.  
2. **Make changes** ensuring code style and formatting remain consistent.  
3. **Add tests** covering your changes if applicable.  
4. Create a **pull request** describing the changes and your rationale.

---

## **License**

`@bnk/sync-react` is open-source software licensed under the [MIT License](LICENSE).  

Enjoy building real-time React apps powered by Bun! For questions, suggestions, or assistance, feel free to open an issue or submit a PR.

# BNK Sync Engine Manager

A lean yet powerful suite of TypeScript libraries built on **Bun** to manage WebSocket connections in a highly modular, pluggable, and type-safe way. This repository contains three key packages:

- **@bnk/sync-engine**  
  A server-side WebSocket manager, ideal for handling stateful or stateless WebSocket connections, message dispatch, heartbeat intervals, and more.  

- **@bnk/sync-client**  
  A flexible client-side WebSocket manager for browser or other WebSocket clients.  

- **@bnk/sync-react**  
  A React-friendly wrapper around the client manager, providing a custom hook and simple context for managing WebSocket connections within React apps.

All three packages are designed to be fast, **minimize external dependencies**, and rely on Bun’s native capabilities whenever possible. Written entirely in **TypeScript**, they leverage advanced TS features like generics, mapped types, intersection types, and well-defined interfaces for maximum **type safety**.

---

## Table of Contents

1. [Introduction](#introduction)  
2. [Installation](#installation)  
3. [Usage Examples](#usage-examples)  
   1. [Server-Side (sync-engine)](#server-side-sync-engine)  
   2. [Client-Side (sync-client)](#client-side-sync-client)  
   3. [React Usage (sync-react)](#react-usage-sync-react)  
4. [API Documentation](#api-documentation)  
5. [Performance Notes](#performance-notes)  
6. [Configuration & Customization](#configuration--customization)  
7. [Testing](#testing)  
8. [Contributing](#contributing)  
9. [License](#license)

---

## Introduction

**BNK Sync Engine Manager** is a small yet focused library that provides a powerful, pluggable architecture for managing WebSocket connections. Key features include:

- **Lean & Fast**  
  Built on Bun with zero or minimal external dependencies for high performance.  
- **Modular & Composable**  
  Each part is pluggable, enabling you to compose or replace functionality easily.  
- **Type-Safe**  
  Written in TypeScript with advanced typing features for confident usage.  
- **Pluggability & Customization**  
  Both server and client managers allow injecting middleware, message handlers, hooks, and more.  
- **React-Friendly**  
  A dedicated React package that simplifies integration into modern React applications.

---

## Installation

With **Bun**, you can install any or all packages in this monorepo:

```bash
# Install the server-side manager
bun add @bnk/sync-engine

# Install the client-side manager
bun add @bnk/sync-client

# Install the React hook & provider
bun add @bnk/sync-react
```

Optionally, you could also install with npm or yarn if you are not exclusively using Bun:

```bash
# Using npm
npm install @bnk/sync-engine @bnk/sync-client @bnk/sync-react

# Using yarn
yarn add @bnk/sync-engine @bnk/sync-client @bnk/sync-react
```

---

## Usage Examples

Below are concise usage examples demonstrating how these packages can be plugged into your application. For more details and advanced usage, see the [API Documentation](#api-documentation).

### Server-Side (@bnk/sync-engine)

**@bnk/sync-engine** gives you a powerful server-side manager that handles message parsing, state management, heartbeat intervals, and more. Here’s a minimal example using Bun’s native `serve`:

```ts
import { serve } from "bun";
import {
  SyncEngine,
  type BaseMessage,
  type MessageHandler
} from "@bnk/sync-engine";

interface MyAppState {
  counter: number;
}

/**
 * Example message: The client might send a "increment" type to increment the state counter.
 */
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
    // Optionally broadcast the updated state or some acknowledgment
  },
};

// Keep track of our in-memory state:
let currentState: MyAppState = { counter: 0 };

async function getState(): Promise<MyAppState> {
  return structuredClone(currentState);
}

async function setState(newState: MyAppState): Promise<void> {
  currentState = structuredClone(newState);
}

const manager = new SyncEngine<MyAppState, IncrementMessage>({
  getState,
  setState,
  messageHandlers: [incrementHandler],
  debug: true, // Enable logging
});

serve({
  port: 3005,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      // Upgrade to WebSocket
      return server.upgrade(req);
    }
    // Fallback for non-WS requests
    return new Response("Hello from Bun server!");
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
      // Optionally, broadcast the new state after handling
      await manager.broadcastState();
    },
  },
});

console.log("Server running at http://localhost:3005");
```

### Client-Side (@bnk/sync-client)

**@bnk/sync-client** provides a lightweight WebSocket manager for the browser (or other WebSocket-enabled environments). It automatically handles connecting, disconnecting, and dispatching messages based on “type”.

```ts
import {
  SyncClientManager,
  type SyncClientManagerConfig,
  type BaseServerMessage,
  type BaseClientMessage,
} from "@bnk/sync-client";

interface IncrementClientMsg extends BaseClientMessage {
  type: "increment";
  amount: number;
}

interface StateUpdateServerMsg extends BaseServerMessage {
  type: "state_update";
  data: { counter: number };
}

// Example usage in vanilla JS/TS (no React):
const config: SyncClientManagerConfig<StateUpdateServerMsg, IncrementClientMsg> = {
  url: "ws://localhost:3005/ws",
  debug: true,
  onOpen: () => console.log("Connected!"),
  onClose: () => console.log("Connection closed."),
  messageHandlers: {
    state_update: (msg) => {
      console.log("New counter value:", msg.data.counter);
    },
  },
};

// Instantiate
const clientManager = new SyncClientManager(config);

// Send a typed message
clientManager.sendMessage({
  type: "increment",
  amount: 5,
});

// Later, disconnect if needed
clientManager.disconnect();
```

### React Usage (@bnk/sync-react)

**@bnk/sync-react** wraps the client manager in a React hook and context. This simplifies usage in function components.

```tsx
import React from "react";
import { useClientWebSocket } from "@bnk/sync-react";
import type {
  BaseClientMessage,
  BaseServerMessage,
} from "@bnk/sync-client";

interface IncrementMsg extends BaseClientMessage {
  type: "increment";
  amount: number;
}

interface StateMsg extends BaseServerMessage {
  type: "state_update";
  data: { counter: number };
}

export function CounterComponent() {
  // We only need to pass a config with a URL and a message handler
  const { isOpen, sendMessage } = useClientWebSocket<StateMsg, IncrementMsg>({
    config: {
      url: "ws://localhost:3005/ws",
      debug: true,
      messageHandlers: {
        state_update: (msg) => {
          console.log("New server state:", msg.data);
        },
      },
    },
  });

  const handleIncrement = () => {
    sendMessage({ type: "increment", amount: 1 });
  };

  return (
    <div>
      <p>WebSocket is {isOpen ? "open" : "closed"}</p>
      <button onClick={handleIncrement}>Increment</button>
    </div>
  );
}
```

---

## API Documentation

### **@bnk/sync-engine**

- **`SyncEngine<TState, TMessage>`**  
  A server-side WebSocket manager with extensive lifecycle hooks.  
  - **`constructor(config: SyncEngineConfig<TState, TMessage>)`**  
  - **`handleOpen(ws: ServerWebSocket<any>): Promise<void>`**  
  - **`handleClose(ws: ServerWebSocket<any>): Promise<void>`**  
  - **`handleMessage(ws: ServerWebSocket<any>, rawMessage: string): Promise<void>`**  
  - **`broadcastState(): Promise<void>`**  

- **`SyncEngineConfig<TState, TMessage>`**  
  - **`getState: () => Promise<TState>`**  
  - **`setState: (state: TState) => Promise<void>`**  
  - **`messageHandlers: Array<MessageHandler<TState, TMessage>>`**  
  - **`debug?: boolean`**  
  - **`hooks?: SyncEngineHooks<TState>`**  
  - **`heartbeatIntervalMs?: number`**  
  - **`pingTimeoutMs?: number`**  

- **`MessageHandler<TState, TMessage>`**  
  - **`type: TMessage["type"]`**  
  - **`handle: (ws, message, getState, setState) => Promise<void>`**  

### **@bnk/sync-client**

- **`SyncClientManager<TIncoming, TOutgoing>`**  
  A client-side manager for typed WebSocket messages.  
  - **`constructor(config: SyncClientManagerConfig<TIncoming, TOutgoing>)`**  
  - **`sendMessage(msg: TOutgoing): void`**  
  - **`disconnect(): void`**  

- **`SyncClientManagerConfig<TIncoming, TOutgoing>`**  
  - **`url: string`**  
  - **`debug?: boolean`**  
  - **`onOpen?: () => void`**  
  - **`onClose?: (event: CloseEvent) => void`**  
  - **`onError?: (event: Event) => void`**  
  - **`messageHandlers?: Record<TIncoming["type"], (msg) => void>`**  

### **@bnk/sync-react**

- **`useClientWebSocket(config: UseClientWebSocketConfig<TIncoming, TOutgoing>)`**  
  - Returns `{ manager, isOpen, sendMessage, disconnect }`.

- **`UseClientWebSocketConfig<TIncoming, TOutgoing>`**  
  - **`manager?: SyncClientManager<TIncoming, TOutgoing>`**  
  - **`config?: Partial<SyncClientManagerConfig<TIncoming, TOutgoing>>`**  

---

## Performance Notes

- **Bun-Native**: All code is built on top of Bun’s native WebSocket and HTTP server, reducing overhead.  
- **Minimal Dependencies**: The packages avoid heavy libraries. In fact, many operations (like JSON parsing) use standard web APIs.  
- **Heartbeat & Reconnection**: The server manager supports sending “ping” and receiving “pong” to keep connections alive and detect stale connections. This helps maintain performance with minimal overhead.  

---

## Configuration & Customization

- **Pluggable Handlers**: Add or remove message handlers to the server manager or client manager as your application grows.  
- **Lifecycle Hooks** (server): The server manager supports optional hooks (e.g., `onConnect`, `onDisconnect`) for custom logic (logging, analytics, etc.).  
- **Middleware**: The backend manager allows registering middleware for pre-processing incoming messages.  
- **React Hook**: The client manager can be consumed directly or through `useClientWebSocket` in React, letting you customize reconnection logic, debug flags, or pass additional message handlers.

---

## Testing

All code is designed to be easily tested using **Bun’s test suite**. For example, in each package:

```bash
bun test
```

Each package has its own `test` scripts. You can run them individually or as part of a monorepo script. Because each package is modular, you can unit-test them in isolation or integration-test them in a combined environment.

---

## Contributing

Contributions are welcome! Please follow these guidelines:

1. **Branching**: Create feature branches from `main` (e.g., `feature/add-something`).  
2. **Code Style**: Keep the codebase consistent with modern TypeScript best practices.  
3. **Testing**: Add or update tests for any new features or bug fixes.  
4. **Pull Request**: Open a PR, providing a clear description of changes.

---

## License

This repository is released under the **MIT License**. See the [LICENSE](LICENSE) file for details.

---

**Enjoy building real-time applications with BNK Sync Engine Manager!** If you have any questions, suggestions, or issues, feel free to open a discussion or issue on GitHub. We appreciate your feedback.
