import { beforeEach, expect, test, vi } from "vitest";
import type TaskContext from "../src/tasks/context";
import type { WaitForPromise } from "../src/tasks/specifics/waitFor";

const state = vi.hoisted(() => ({
    live: [] as Array<string | null>,
    windowId: 1,
    menuSlots: 54,
    visibleGui: { windowId: 7, itemCount: 1 },
}));
vi.mock("../src/tasks/specifics/slots", () => ({
    getMenuItemSlots: () =>
        state.live.flatMap((item, index) =>
            item === null
                ? []
                : [
                      {
                          getSlotId: () => index,
                          getItem: () => ({ getRawNBT: () => item }),
                      },
                  ]
        ),
    getOpenContainerWindowId: () => state.windowId,
    getDisplayedGuiMenuState: () => state.visibleGui,
    menuStateDescription: () => "Edit Actions",
    describeGuiScreenMenu: () => "GuiChest",
}));
vi.mock("../src/tasks/specifics/waitFor", () => ({
    describeRecentWindowOpens: () => "",
}));
vi.mock("../src/housingSync/trace/taskTrace", () => ({
    isTaskTraceEnabled: () => false,
    traceMenuWait: vi.fn(),
}));
vi.mock("../src/utils/packets", () => ({
    S2DPacketOpenWindow: class {
        constructor(public id: number) {}
    },
    S30PacketWindowItems: class {
        constructor(
            public id: number,
            public stacks: Array<string | null>
        ) {}
    },
    openWindowPacketId: (p: { id: number }) => p.id,
    windowItemsPacketId: (p: { id: number }) => p.id,
    windowItemsPacketStacks: (p: { stacks: Array<string | null> }) => p.stacks,
}));
import { S2DPacketOpenWindow, S30PacketWindowItems } from "../src/utils/packets";
import { waitForMenu } from "../src/housingSync/menus/menuWait";

const flush = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
};
function harness() {
    let onPacket: ((p: unknown) => boolean) | undefined;
    let resolvePacket: (() => void) | undefined;
    let tick: (() => void) | undefined;
    let expire: ((error: Error) => void) | undefined;
    const ctx = {
        waitFor: (event: string, check?: (p: unknown) => boolean) => {
            const promise = new Promise<void>((resolve) => {
                if (event === "packetReceived") {
                    onPacket = check;
                    resolvePacket = resolve;
                } else tick = resolve;
            }) as WaitForPromise<void>;
            promise.cleanupWaiter = () => {
                if (event === "packetReceived") {
                    onPacket = undefined;
                    resolvePacket = undefined;
                } else tick = undefined;
            };
            return promise;
        },
        withTimeout: (inner: WaitForPromise<void>) => {
            const timeout = new Promise<void>((_resolve, reject) => {
                expire = reject;
            });
            const result = Promise.race([inner, timeout]) as WaitForPromise<void>;
            result.cleanupWaiter = inner.cleanupWaiter;
            return result;
        },
        finishChatPrompt: vi.fn(),
    };
    return {
        ctx: ctx as unknown as TaskContext,
        send: (packet: unknown) => {
            if (onPacket?.(packet)) {
                const resolve = resolvePacket;
                onPacket = undefined;
                resolve?.();
            }
        },
        tick: async () => {
            const resolve = tick;
            tick = undefined;
            resolve?.();
            await flush();
        },
        expire: () =>
            expire!(new Error("Timeout after 6000ms: Waiting for menu to load")),
    };
}
function packet(slots: Array<string | null>) {
    // Packet constructors are mocked with the protocol fields used by the wait.
    return new (
        S30PacketWindowItems as unknown as new (
            id: number,
            stacks: Array<string | null>
        ) => object
    )(7, [...slots, ...Array<null>(36).fill(null)]);
}
const openPacket = () =>
    new (S2DPacketOpenWindow as unknown as new (id: number) => object)(7);
const padded = (value: string, slot = 10) =>
    Array.from({ length: 54 }, (_, i) => (i === slot ? value : null));
beforeEach(() => {
    state.live = padded("old lore");
    state.windowId = 7;
    state.menuSlots = 54;
    vi.stubGlobal(
        "Item",
        class {
            constructor(private nbt: string) {}
            getRawNBT() {
                return this.nbt;
            }
        }
    );
    vi.stubGlobal("Player", {
        getContainer: () => ({
            getSize: () => state.menuSlots + 36,
            getStackInSlot: (i: number) =>
                state.live[i] == null ? null : { getRawNBT: () => state.live[i] },
        }),
    });
});

test("equal item counts with stale lore do not pass until the snapshot is applied", async () => {
    const h = harness();
    let ready = false;
    const result = waitForMenu(h.ctx).then(() => {
        ready = true;
    });
    h.send(openPacket());
    h.send(packet(padded("new lore")));
    await flush();
    expect(ready).toBe(false);
    await h.tick();
    expect(ready).toBe(false);
    state.live = padded("new lore");
    await h.tick();
    await result;
    expect(ready).toBe(true);
});

test.each(["wrong slot", "wrong size", "wrong window"])(
    "rejects a populated %s until it agrees with WindowItems",
    async (wrong) => {
        const h = harness();
        let ready = false;
        state.live = padded("new lore", wrong === "wrong slot" ? 11 : 10);
        if (wrong === "wrong size") state.menuSlots = 27;
        if (wrong === "wrong window") state.windowId = 6;
        const result = waitForMenu(h.ctx).then(() => {
            ready = true;
        });
        h.send(openPacket());
        h.send(packet(padded("new lore")));
        await flush();
        expect(ready).toBe(false);
        state.live = padded("new lore");
        state.menuSlots = 54;
        state.windowId = 7;
        await h.tick();
        await result;
    }
);

test("a populated visible GUI cannot recover a timeout while the reader's container is stale", async () => {
    const h = harness();
    const result = waitForMenu(h.ctx);
    const assertion = expect(result).rejects.toThrow("Timeout after 6000ms");
    h.send(openPacket());
    h.send(packet(padded("new lore")));
    await flush();
    h.expire();
    await assertion;
    result.cleanupWaiter?.();
});

test("persistent content mismatch fails after the bounded tick wait", async () => {
    const h = harness();
    const result = waitForMenu(h.ctx);
    const assertion = expect(result).rejects.toThrow("Menu not ready within 80 ticks");
    h.send(openPacket());
    h.send(packet(padded("new lore")));
    await flush();
    for (let i = 0; i < 80; i++) await h.tick();
    await assertion;
});
