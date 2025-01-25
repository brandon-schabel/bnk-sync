import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { BackendWebSocketManager } from "./backend-websocket-manager";
import type {
  BackendWebSocketManagerConfig,
  BaseMessage,
  MessageHandler,
  BackendWebSocketPersistenceAdapter,
  VersionedWebSocketData,
} from "./backend-websocket-types";
import { z } from "zod";

// Test state type
type TestState = { counter: number };

// Message types
interface IncrementMessage extends BaseMessage {
  type: "increment";
  amount: number;
}

interface DecrementMessage extends BaseMessage {
  type: "decrement";
  amount: number;
}

type TestMessage = IncrementMessage | DecrementMessage;

// Message schema for validation
const messageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("increment"),
    amount: z.number(),
  }),
  z.object({
    type: z.literal("decrement"),
    amount: z.number(),
  }),
]);

// Mock adapter for testing persistence
class MockAdapter implements BackendWebSocketPersistenceAdapter<TestState> {
  private store: VersionedWebSocketData<TestState> = {
    state: { counter: 0 },
    version: 0,
  };

  init = mock(async () => {});
  load = mock(async () => this.store);
  save = mock(async (state: TestState, version: number) => {
    this.store = { state, version };
  });
  backup = mock(async () => {});
}

describe("BackendWebSocketManager", () => {
  let manager: BackendWebSocketManager<TestState, TestMessage>;
  let mockWs: any;
  let mockAdapter: MockAdapter;
  let hookCalls: Record<string, number>;

  // Message handlers
  const incrementHandler: MessageHandler<TestState, TestMessage> = {
    type: "increment",
    handle: async (ws, message, getState, setState) => {
      if (message.type !== "increment") return;
      const current = await getState();
      await setState({ counter: current.counter + message.amount });
    },
  };

  const decrementHandler: MessageHandler<TestState, TestMessage> = {
    type: "decrement",
    handle: async (ws, message, getState, setState) => {
      if (message.type !== "decrement") return;
      const current = await getState();
      await setState({ counter: current.counter - message.amount });
    },
  };

  beforeEach(async () => {
    mockWs = {
      readyState: WebSocket.OPEN,
      send: mock((data: string) => {}),
      close: mock(() => {}),
    };

    mockAdapter = new MockAdapter();
    hookCalls = {
      onConnect: 0,
      onDisconnect: 0,
      onStateChange: 0,
      onSync: 0,
      onBackup: 0,
      onPing: 0,
      onPong: 0,
    };

    const config: BackendWebSocketManagerConfig<TestState, TestMessage> = {
      initialState: { counter: 0 },
      messageHandlers: [incrementHandler, decrementHandler],
      enableVersioning: true,
      adapter: mockAdapter,
      debug: false,
      validateMessage: (raw) => messageSchema.parse(raw),
      hooks: {
        onConnect: async () => { hookCalls.onConnect++; },
        onDisconnect: async () => { hookCalls.onDisconnect++; },
        onStateChange: async () => { hookCalls.onStateChange++; },
        onSync: async () => { hookCalls.onSync++; },
        onBackup: async () => { hookCalls.onBackup++; },
        onPing: async () => { hookCalls.onPing++; },
        onPong: async () => { hookCalls.onPong++; },
      },
    };

    manager = new BackendWebSocketManager(config);
    await new Promise((resolve) => setTimeout(resolve, 10)); // Wait for init
  });

  afterEach(() => {
    manager.dispose();
  });

  describe("Initialization", () => {
    it("loads state from adapter on init", async () => {
      expect(mockAdapter.init.mock.calls.length).toBe(1);
      expect(mockAdapter.load.mock.calls.length).toBe(1);
      expect(manager.getState().counter).toBe(0);
      expect(manager.getVersion()).toBe(0);
    });

    it("sends initial state on connection", async () => {
      await manager.handleOpen(mockWs);
      expect(mockWs.send.mock.calls.length).toBe(1);
      expect(hookCalls.onConnect).toBe(1);

      const sentPayload = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentPayload.type).toBe("initial_state");
      expect(sentPayload.data).toEqual({ counter: 0 });
    });
  });

  describe("Message Handling", () => {
    it("processes valid increment message", async () => {
      await manager.handleOpen(mockWs);
      const msg = JSON.stringify({ type: "increment", amount: 5 });
      await manager.handleMessage(mockWs, msg);

      expect(manager.getState().counter).toBe(5);
      expect(manager.getVersion()).toBe(1);
      expect(hookCalls.onStateChange).toBe(1);
      expect(hookCalls.onSync).toBe(1);
      expect(mockAdapter.save.mock.calls.length).toBe(1);
    });

    it("processes valid decrement message", async () => {
      await manager.handleOpen(mockWs);
      const msg = JSON.stringify({ type: "decrement", amount: 3 });
      await manager.handleMessage(mockWs, msg);

      expect(manager.getState().counter).toBe(-3);
      expect(manager.getVersion()).toBe(1);
      expect(hookCalls.onStateChange).toBe(1);
    });

    it("rejects invalid message schema", async () => {
      await manager.handleOpen(mockWs);
      const msg = JSON.stringify({ type: "increment", amount: "not a number" });
      await manager.handleMessage(mockWs, msg);

      // State should not change
      expect(manager.getState().counter).toBe(0);
      expect(manager.getVersion()).toBe(0);
      expect(hookCalls.onStateChange).toBe(0);
    });

    it("processes messages through middleware", async () => {
      // Add middleware that doubles increment amounts
      await manager.use(async (msg) => {
        if (msg.type === "increment") {
          return { ...msg, amount: msg.amount * 2 };
        }
        return msg;
      });

      await manager.handleOpen(mockWs);
      const msg = JSON.stringify({ type: "increment", amount: 5 });
      await manager.handleMessage(mockWs, msg);

      expect(manager.getState().counter).toBe(10); // 5 * 2
    });
  });

  describe("Heartbeat & Ping/Pong", () => {
    it("handles pong messages", async () => {
      await manager.handleOpen(mockWs);
      await manager.handleMessage(mockWs, "pong");
      expect(hookCalls.onPong).toBe(1);
    });

    it("sends ping messages on interval", async () => {
      manager.dispose();
      
      const config: BackendWebSocketManagerConfig<TestState, TestMessage> = {
        initialState: { counter: 0 },
        messageHandlers: [incrementHandler],
        heartbeatIntervalMs: 50,
        hooks: {
          onPing: async () => { hookCalls.onPing++; },
        },
      };

      manager = new BackendWebSocketManager(config);
      await manager.handleOpen(mockWs);

      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(hookCalls.onPing).toBeGreaterThan(1);
    });
  });

  describe("State Management", () => {
    it("broadcasts state updates", async () => {
      const ws2 = { ...mockWs, send: mock((data: string) => {}) };
      await manager.handleOpen(mockWs);
      await manager.handleOpen(ws2);

      await manager.handleMessage(mockWs, JSON.stringify({ type: "increment", amount: 5 }));
      await manager.broadcastState();

      // Both clients should receive the update
      expect(mockWs.send.mock.calls.length).toBe(2); // initial + broadcast
      expect(ws2.send.mock.calls.length).toBe(2);

      const broadcast1 = JSON.parse(mockWs.send.mock.calls[1][0]);
      const broadcast2 = JSON.parse(ws2.send.mock.calls[1][0]);
      expect(broadcast1.data.counter).toBe(5);
      expect(broadcast2.data.counter).toBe(5);
    });

    it("creates backups when requested", async () => {
      await manager.createBackup();
      expect(mockAdapter.backup.mock.calls.length).toBe(1);
      expect(hookCalls.onBackup).toBe(1);
    });

    it("syncs state periodically if configured", async () => {
      manager.dispose();
      
      const config: BackendWebSocketManagerConfig<TestState, TestMessage> = {
        initialState: { counter: 0 },
        messageHandlers: [incrementHandler],
        adapter: mockAdapter,
        syncIntervalMs: 50,
      };

      manager = new BackendWebSocketManager(config);
      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(mockAdapter.save.mock.calls.length).toBeGreaterThan(1);
    });
  });

  describe("Cleanup", () => {
    it("disposes resources properly", async () => {
      const ws2 = { ...mockWs, close: mock(() => {}) };
      await manager.handleOpen(mockWs);
      await manager.handleOpen(ws2);

      manager.dispose();

      expect(mockWs.close.mock.calls.length).toBe(1);
      expect(ws2.close.mock.calls.length).toBe(1);
    });
  });
});