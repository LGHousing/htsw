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
            // Mirrors 1.8.9 FontRenderer.getStringWidth at 1 unit per glyph:
            // a "§x" pair is free, and bold costs one extra unit per glyph
            // after it. Note only "§r" clears bold there — a color code does
            // NOT — so the emulation keeps that quirk rather than the
            // renderer's. "&" is an ordinary character, as it is in game.
            func_78256_a: (text: string) => {
                let width = 0;
                let bold = false;
                for (let i = 0; i < text.length; i++) {
                    const ch = text.charAt(i);
                    if (ch === "§" && i + 1 < text.length) {
                        const code = text.charAt(i + 1).toLowerCase();
                        if (code === "l") bold = true;
                        else if (code === "r") bold = false;
                        i++;
                        continue;
                    }
                    width += bold ? 2 : 1;
                }
                return width;
            },
        },
    }),
});
stubGlobal("ChatLib", {
    chat: () => undefined,
    command: () => undefined,
    say: () => undefined,
    getChatWidth: () => 320,
    // Mirrors ChatTriggers: addColor is "&"->"§", replaceFormatting is the other
    // direction, and removeFormatting strips both spellings. The mock used to
    // have addColor's behaviour under replaceFormatting's name, which made a
    // measurement bug pass its tests and only show up in game.
    addColor: (text: string) => text.replace(/&([0-9a-fklmnor])/gi, "§$1"),
    replaceFormatting: (text: string) => text.replace(/§([0-9a-fklmnor])/gi, "&$1"),
    removeFormatting: (text: string) => text.replace(/[&§][0-9a-fklmnor]/gi, ""),
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
