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
stubGlobal("Client", {
    sendPacket: () => undefined,
    getMinecraft: () => ({
        field_71466_p: {
            func_78256_a: (text: string) => text.replace(/(?:§|&)[0-9a-fklmnor]/gi, "").length,
        },
    }),
});
stubGlobal("ChatLib", {
    chat: () => undefined,
    command: () => undefined,
    say: () => undefined,
    getChatWidth: () => 320,
    replaceFormatting: (text: string) => text.replace(/&([0-9a-fklmnor])/gi, "§$1"),
    removeFormatting: (text: string) => text.replace(/§[0-9a-fklmnor]/gi, ""),
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
