// Stub the ChatTriggers / Rhino globals so modules that touch them at
// eager module-load time (e.g. gui/lib/java.ts's GL11 const) can be
// imported under node. Tests should not depend on these returning real
// values — a test that needs a CT primitive should be rewritten to take
// its dependency by parameter or run inside the live CT runtime.

const stubGlobal = (name: string, value: unknown) => {
    if ((globalThis as Record<string, unknown>)[name] === undefined) {
        (globalThis as Record<string, unknown>)[name] = value;
    }
};

stubGlobal("Java", {
    type: () => new Proxy({}, { get: () => () => undefined }),
});
stubGlobal("Client", { sendPacket: () => undefined });
stubGlobal("ChatLib", {
    chat: () => undefined,
    command: () => undefined,
    say: () => undefined,
});
stubGlobal("Player", { getName: () => "tester" });
stubGlobal("World", { playSound: () => undefined });
stubGlobal("register", () => undefined);
stubGlobal("cancel", () => undefined);
stubGlobal("FileLib", {
    exists: () => false,
    read: () => null,
    write: () => undefined,
});
