# **BNK Websocket Manger**

A modern, type-safe, and performant React WebSocket interface built entirely on Bun. This library streamlines WebSocket integration in React applications, providing **pluggable** and **composable** APIs with zero external dependencies for the base libraries. Leverage the power of Bun’s native WebSocket performance while enjoying a fully typed, developer-friendly experience.

---

## **Table of Contents**

1. [Introduction](#introduction)  
2. [Installation](#installation)  
3. [Usage Examples](#usage-examples)  
   - [Basic React Usage](#basic-react-usage)  
   - [Using the Provided Hook](#using-the-provided-hook)  
   - [Fullstack Integration With @bnk/backend-websocket-manager](#fullstack-integration-with-bnkwebsocket-manager)  
4. [API Documentation](#api-documentation)  
   - [Types](#types)  
   - [ClientWebSocketManager](#clientwebsocketmanager)  
   - [useClientWebSocket](#useclientwebsocket)  
5. [Performance Notes](#performance-notes)  
6. [Configuration & Customization](#configuration--customization)  
7. [Testing](#testing)  
8. [Contributing](#contributing)  
9. [License](#license)

---

## **Introduction**

`@bnk/react-websocket-manager` is a React-specific wrapper around the core client WebSocket logic from [`@bnk/client-websocket-manager`](https://www.npmjs.com/package/@bnk/client-websocket-manager). Its primary goal is to:

- Provide a **modern**, **type-safe** interface for WebSockets in React applications.  
- Deliver **high performance** by leveraging **Bun**’s native WebSocket.  
- Encourage **plug-and-play modularity** through composable hooks and providers.  
- Offer **minimal** external dependencies (none besides React).  
- Ensure an ergonomic developer experience, with advanced TypeScript usage (generics, mapped types, intersection types, etc.).

This library pairs seamlessly with [`@bnk/backend-websocket-manager`](https://www.npmjs.com/package/@bnk/backend-websocket-manager) on the backend, letting you build a complete fullstack WebSocket solution in a type-safe manner.

---

## **Installation**

Using Bun:

```bash
bun add @bnk/react-websocket-manager
```

---

## **Usage Examples**

### **Basic React Usage**

Below is a minimal setup in a React application. This example assumes you have a WebSocket server running at `ws://localhost:3007/ws` built on Bun.

```tsx
import React from "react";
import { useClientWebSocket } from "@bnk/react-websocket-manager";

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
- `manager` – The underlying `ClientWebSocketManager` instance, if needed for advanced usage.

**Example With an Existing Manager**  
If you already have a `ClientWebSocketManager` instance (for instance, if you create it elsewhere and want to pass it down), you can just inject it:

```tsx
import React, { useState } from "react";
import {
  ClientWebSocketManager,
  type BaseServerMessage,
  type BaseClientMessage,
} from "@bnk/client-websocket-manager";
import { useClientWebSocket } from "@bnk/react-websocket-manager";

const existingManager = new ClientWebSocketManager<BaseServerMessage, BaseClientMessage>({
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

### **Fullstack Integration With `@bnk/backend-websocket-manager`**

Below is an outline demonstrating how you might integrate the React library on the frontend with the Bun-based WebSocket manager on the backend.

#### Backend (Bun + `@bnk/backend-websocket-manager`)

```ts
// server.ts
import { serve } from "bun";
import {
  BackendWebSocketManager,
  type BaseMessage,
  type MessageHandler
} from "@bnk/backend-websocket-manager";

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

const manager = new BackendWebSocketManager<MyState, ChatMessage>({
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

#### Frontend (React + `@bnk/react-websocket-manager`)

```tsx
// App.tsx
import React from "react";
import { useClientWebSocket } from "@bnk/react-websocket-manager";

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

### **`ClientWebSocketManager`**

A generic class that manages a single WebSocket connection client-side. It handles:

1. **Connection logic** (open, close, reconnect).  
2. **Sending typed messages** with `sendMessage()`.  
3. **Processing server messages** via a `messageHandlers` map.  

**Constructor**  

```ts
constructor(config: ClientWebSocketManagerConfig<TIncoming, TOutgoing>)
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
const manager = new ClientWebSocketManager({
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

A React hook that abstracts the `ClientWebSocketManager`. Returns a simple interface to send messages and track connection state in React.

```ts
function useClientWebSocket<TIncoming extends BaseServerMessage, TOutgoing extends BaseClientMessage>(
  config: UseClientWebSocketConfig<TIncoming, TOutgoing>
): {
  manager: ClientWebSocketManager<TIncoming, TOutgoing> | null;
  isOpen: boolean;
  sendMessage: (msg: TOutgoing) => void;
  disconnect: () => void;
}
```

| Return Key        | Description                                                        |
| ----------------- | ------------------------------------------------------------------ |
| `manager`         | The internal `ClientWebSocketManager` instance.                    |
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
- If you have multiple WebSockets or special domain logic, you can **reuse** the `ClientWebSocketManager` instance and pass it to `useClientWebSocket`.

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

---

## **Contributing**

Contributions are welcome! Please:

1. **Fork** the repository and create a new branch.  
2. **Make changes** ensuring code style and formatting remain consistent.  
3. **Add tests** covering your changes if applicable.  
4. Create a **pull request** describing the changes and your rationale.

---

## **License**

`@bnk/react-websocket-manager` is open-source software licensed under the [MIT License](LICENSE).  

Enjoy building real-time React apps powered by Bun! For questions, suggestions, or assistance, feel free to open an issue or submit a PR.
