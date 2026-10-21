import { beforeEach, expect, test, vi } from "vitest";
import type TaskContext from "@htsw/importer/tasks/context";
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
vi.mock("@htsw/importer/housingSync/trace/taskTrace", () => ({
    isTaskTraceEnabled: () => false,
    traceMenuWait: vi.fn(),
}));
vi.mock("../src/utils/packets", () => ({
    S2DPacketOpenWindow: class {
        constructor(public id: number) {}
    },
    S2FPacketSetSlot: class {
        constructor(
            public id: number,
            public slot: number,
            public stack: string | null
        ) {}
    },
    S30PacketWindowItems: class {
        constructor(
            public id: number,
            public stacks: Array<string | null>
        ) {}
    },
    setSlotPacketWindowId: (p: { id: number }) => p.id,
    setSlotPacketSlot: (p: { slot: number }) => p.slot,
    setSlotPacketStack: (p: { stack: string | null }) => p.stack,
    openWindowPacketId: (p: { id: number }) => p.id,
    windowItemsPacketId: (p: { id: number }) => p.id,
    windowItemsPacketStacks: (p: { stacks: Array<string | null> }) => p.stacks,
}));
import {
    S2DPacketOpenWindow,
    S2FPacketSetSlot,
    S30PacketWindowItems,
} from "../src/utils/packets";
import { createTaskCancelledError } from "@htsw/importer/tasks/cancellation";
import { waitForMenu } from "@htsw/importer/housingSync/menus/menuWait";

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
        hasPacketListener: () => onPacket !== undefined,
        expire: (error = new Error("Timeout after 6000ms: Waiting for menu to load")) =>
            expire!(error),
    };
}
function packet(slots: Array<string | null>, windowId = 7) {
    // Packet constructors are mocked with the protocol fields used by the wait.
    return new (
        S30PacketWindowItems as unknown as new (
            id: number,
            stacks: Array<string | null>
        ) => object
    )(windowId, [...slots, ...Array<null>(36).fill(null)]);
}
function setSlot(slot: number, stack: string | null, windowId = 7) {
    return new (
        S2FPacketSetSlot as unknown as new (
            id: number,
            slot: number,
            stack: string | null
        ) => object
    )(windowId, slot, stack);
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
    const assertion = expect(result).rejects.toThrow(
        /^HTSW_INCOMPLETE_READ: Timeout after 6000ms/
    );
    h.send(openPacket());
    h.send(packet(padded("new lore")));
    await flush();
    h.expire();
    await assertion;
    expect(h.hasPacketListener()).toBe(false);
});

test("persistent content mismatch fails after the bounded tick wait", async () => {
    const h = harness();
    const result = waitForMenu(h.ctx);
    const assertion = expect(result).rejects.toThrow(
        /^HTSW_INCOMPLETE_READ: Menu not ready within 80 ticks/
    );
    h.send(openPacket());
    h.send(packet(padded("new lore")));
    await flush();
    for (let i = 0; i < 80; i++) await h.tick();
    await assertion;
    expect(h.hasPacketListener()).toBe(false);
});

test.each(["WindowItems", "SetSlot"])(
    "readiness follows a later %s lore change and waits for its application",
    async (kind) => {
        const h = harness();
        let ready = false;
        const result = waitForMenu(h.ctx).then(() => {
            ready = true;
        });
        h.send(openPacket());
        h.send(packet(padded("first lore")));
        await flush();
        expect(h.hasPacketListener()).toBe(true);
        h.send(
            kind === "WindowItems"
                ? packet(padded("updated lore"))
                : setSlot(10, "updated lore")
        );
        state.live = padded("first lore");
        await h.tick();
        expect(ready).toBe(false);
        state.live = padded("updated lore");
        await h.tick();
        await result;
        expect(ready).toBe(true);
        expect(h.hasPacketListener()).toBe(false);
    }
);

test("SetSlot additions and removals update the expected occupied slots", async () => {
    const h = harness();
    const result = waitForMenu(h.ctx);
    h.send(openPacket());
    h.send(packet(padded("first lore")));
    await flush();
    h.send(setSlot(10, null));
    h.send(setSlot(11, "moved item"));
    h.send(setSlot(12, "added item"));
    state.live = padded("moved item", 11);
    state.live[12] = "added item";
    await h.tick();
    await result;
    expect(h.hasPacketListener()).toBe(false);
});

test("ignores updates for another window, the cursor, and player inventory", async () => {
    const h = harness();
    const result = waitForMenu(h.ctx);
    h.send(openPacket());
    h.send(packet(padded("first lore")));
    await flush();
    h.send(packet(padded("unrelated"), 8));
    h.send(setSlot(10, "unrelated", 8));
    h.send(setSlot(-1, "cursor"));
    h.send(setSlot(54, "inventory"));
    state.live = padded("first lore");
    await h.tick();
    await result;
    expect(h.hasPacketListener()).toBe(false);
});

test("cancellation retains its classification and removes the packet listener", async () => {
    const h = harness();
    const result = waitForMenu(h.ctx);
    const cancelled = createTaskCancelledError();
    const assertion = expect(result).rejects.toBe(cancelled);
    h.send(openPacket());
    h.send(packet(padded("first lore")));
    await flush();
    h.expire(cancelled);
    await assertion;
    expect(h.hasPacketListener()).toBe(false);
});

test("abandoning a menu wait removes the packet listener", async () => {
    const h = harness();
    const result = waitForMenu(h.ctx);
    h.send(openPacket());
    h.send(packet(padded("first lore")));
    await flush();
    result.cleanupWaiter?.();
    expect(h.hasPacketListener()).toBe(false);
});
