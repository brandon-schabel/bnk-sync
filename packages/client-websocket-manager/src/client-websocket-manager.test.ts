// File: client-websocket-manager.test.ts
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { ClientWebSocketManager } from "./client-websocket-manager";
import type { ClientWebSocketManagerConfig } from "./client-websocket-manager";
import type { BaseClientMessage, BaseServerMessage } from "./client-websocket-types";

/**
 * Because the 'WebSocket' global isn't always available when running Bun tests,
 * we can either:
 *   1) Provide a mock WebSocket class that we attach to globalThis, or
 *   2) Use a real environment with a real WebSocket server.
 *
 * For a unit test, we typically mock. We'll do a minimal mock here.
 */

// Define minimal message types to test with:
interface TestIncomingMessage extends BaseServerMessage {
    type: "test_incoming";
    data: { value: number };
}
interface TestOutgoingMessage extends BaseClientMessage {
    type: "test_outgoing";
    payload: { text: string };
}

// We'll create a small mock for the native WebSocket class.
class MockWebSocket {
    public url: string;
    public readyState: 0 | 1 | 2 | 3 = WebSocket.CONNECTING; // Start in CONNECTING state
    public sentData: string[] = [];
    private eventListeners: Record<string, ((ev?: any) => void)[]> = {};

    constructor(url: string) {
        this.url = url;
        // Explicitly start in CONNECTING state
        this.readyState = WebSocket.CONNECTING;
    }

    public send(data: string) {
        // Only allow sending if socket is OPEN
        if (this.readyState === WebSocket.OPEN) {
            this.sentData.push(data);
        }
    }

    public close() {
        this.readyState = WebSocket.CLOSED;
        this.triggerEvent("close", { reason: "mock-closed" });
    }

    public addEventListener(type: string, handler: (ev?: any) => void) {
        if (!this.eventListeners[type]) {
            this.eventListeners[type] = [];
        }
        this.eventListeners[type].push(handler);
    }

    public removeEventListener(type: string, handler: (ev?: any) => void) {
        this.eventListeners[type] = this.eventListeners[type]?.filter(h => h !== handler) || [];
    }

    /**
     * Helper to simulate the WebSocket reaching an OPEN state
     */
    public simulateOpen() {
        this.readyState = WebSocket.OPEN;
        this.triggerEvent("open");
    }

    /**
     * Helper to simulate receiving a message from server
     */
    public simulateMessage(message: any) {
        this.triggerEvent("message", { data: JSON.stringify(message) });
    }

    private triggerEvent(type: string, eventData?: any) {
        const handlers = this.eventListeners[type] || [];
        handlers.forEach((handler) => handler(eventData));
    }
}

// Attach our mock to globalThis so that `new WebSocket(...)` uses it
(globalThis as any).WebSocket = MockWebSocket;

describe("ClientWebSocketManager", () => {
    let manager: ClientWebSocketManager<TestIncomingMessage, TestOutgoingMessage> | null = null;

    afterEach(() => {
        // Disconnect and clear manager after each test.
        manager?.disconnect(true);
        manager = null;
    });

    it("should construct and connect to the provided URL", () => {
        const testUrl = "ws://fake-url";
        manager = new ClientWebSocketManager<TestIncomingMessage, TestOutgoingMessage>({
            url: testUrl,
            debug: false,
        });

        // We can check that the underlying WebSocket was created:
        expect((manager as any).socket).toBeTruthy();
        expect((manager as any).socket.url).toBe(testUrl);
    });

    it("should call onOpen when WebSocket opens", () => {
        let onOpenCalled = false;
        manager = new ClientWebSocketManager<TestIncomingMessage, TestOutgoingMessage>({
            url: "ws://fake-url",
            debug: false,
            onOpen: () => {
                onOpenCalled = true;
            },
        });

        // Simulate the WebSocket finishing its connection
        const socket = (manager as any).socket as MockWebSocket;
        socket.simulateOpen();

        expect(onOpenCalled).toBe(true);
    });

    it("should call onClose when WebSocket closes", () => {
        let onCloseCalled = false;
        manager = new ClientWebSocketManager<TestIncomingMessage, TestOutgoingMessage>({
            url: "ws://fake-url",
            debug: false,
            onClose: () => {
                onCloseCalled = true;
            },
        });

        const socket = (manager as any).socket as MockWebSocket;
        // Mark the socket as open first
        socket.simulateOpen();

        // Now close it
        socket.close();
        expect(onCloseCalled).toBe(true);
    });

    it("should send a validated message if socket is open", () => {
        // We'll mock validateOutgoingMessage to ensure it's used
        const mockValidateOutgoing = mock((msg: TestOutgoingMessage) => {
            // If we want to do stricter checks, do them here, then return msg
            return msg;
        });

        manager = new ClientWebSocketManager<TestIncomingMessage, TestOutgoingMessage>({
            url: "ws://fake-url",
            debug: false,
            validateOutgoingMessage: mockValidateOutgoing,
        });

        const socket = (manager as any).socket as MockWebSocket;
        socket.simulateOpen();

        const outgoing: TestOutgoingMessage = {
            type: "test_outgoing",
            payload: { text: "Hello from client" },
        };
        manager.sendMessage(outgoing);

        // Validate that the message was indeed validated and then sent
        expect(mockValidateOutgoing.mock.calls.length).toBe(1);
        expect(socket.sentData.length).toBe(1);
        const sentRaw = socket.sentData[0];
        const parsed = JSON.parse(sentRaw);
        expect(parsed).toEqual(outgoing);
    });

    it("should validate incoming messages if validateIncomingMessage is provided", () => {
        const mockValidateIncoming = mock((raw: unknown) => {
            // Return it as-is if it passes your checks
            if (typeof raw === "object" && raw !== null && (raw as any).type === "test_incoming") {
                return raw as TestIncomingMessage;
            }
            throw new Error("Invalid incoming");
        });

        let handlerCalled = false;
        manager = new ClientWebSocketManager<TestIncomingMessage, TestOutgoingMessage>({
            url: "ws://fake-url",
            validateIncomingMessage: mockValidateIncoming,
            messageHandlers: {
                test_incoming: (msg) => {
                    handlerCalled = true;
                    expect(msg.data).toEqual({ value: 123 });
                },
            },
        });

        const socket = (manager as any).socket as MockWebSocket;
        socket.simulateOpen();

        // Now simulate a message from the server
        socket.simulateMessage({
            type: "test_incoming",
            data: { value: 123 },
        });

        expect(mockValidateIncoming.mock.calls.length).toBe(1);
        expect(handlerCalled).toBe(true);
    });

    it("should handle auto-reconnect if enabled", async () => {
        let reconnectCalled = 0;
        manager = new ClientWebSocketManager<TestIncomingMessage, TestOutgoingMessage>({
            url: "ws://fake-url",
            debug: false,
            autoReconnect: true,
            reconnectIntervalMs: 10,
            maxReconnectAttempts: 2,
            onReconnect: (attempt) => {
                reconnectCalled = attempt;
            },
        });

        // Let's simulate the socket being open, then forcibly closed:
        const socket = (manager as any).socket as MockWebSocket;
        socket.simulateOpen();
        socket.close();

        // We expect it to schedule a reconnect attempt:
        // Because we used a short reconnectIntervalMs, let's wait a bit.
        await new Promise((r) => setTimeout(r, 50));

        // The second attempt might or might not fire quickly enough, but let's check:
        expect(reconnectCalled).toBeGreaterThanOrEqual(1);
        expect(reconnectCalled).toBeLessThanOrEqual(2);
    });
});