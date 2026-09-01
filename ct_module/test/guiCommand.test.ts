import { describe, expect, test } from "vitest";

import { resolveHtswGuiCommand } from "../src/slashCommands/gui";

describe("gui command", () => {
    test("parses bare, on, off and status actions", () => {
        const state = { enabled: true, visible: true };

        expect(resolveHtswGuiCommand(state, []).action).toBe("toggle");
        expect(resolveHtswGuiCommand(state, ["ON"]).action).toBe("enable");
        expect(resolveHtswGuiCommand(state, ["off"]).action).toBe("disable");
        expect(resolveHtswGuiCommand(state, ["status"]).action).toBe("none");
    });

    test("formats each overlay state with a hint", () => {
        expect(
            resolveHtswGuiCommand({ enabled: true, visible: true }, ["status"]).message
        ).toBe("&e[htsw] gui &aenabled &7(visible)");
        expect(
            resolveHtswGuiCommand({ enabled: true, visible: false }, ["status"]).message
        ).toBe(
            "&e[htsw] gui &aenabled " +
                "&7(draws over open Housing menus; not visible now because no menu is open)"
        );
        expect(
            resolveHtswGuiCommand({ enabled: false, visible: false }, ["status"]).message
        ).toBe("&e[htsw] gui &cdisabled &7(use /htsw gui on)");
    });

    test("reports usage, current state and a hint for an unknown argument", () => {
        expect(
            resolveHtswGuiCommand({ enabled: false, visible: false }, ["maybe"])
        ).toEqual({
            action: "none",
            message:
                "&cUsage: /htsw gui [on|off|status] " +
                "&7(current state: &cdisabled&7; use /htsw gui on)",
        });
    });
});
