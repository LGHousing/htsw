import { describe, expect, test } from "vitest";

import { parseAutomaticExecutionTicks } from "../src/importables/functions/housing";

describe("automatic execution lore", () => {
    test("reads 5 ticks from plausible ON-state lore with formatting codes", () => {
        for (const current of ["§a5", "§a5 §7ticks", "§aEvery §b5 §aticks"]) {
            expect(
                parseAutomaticExecutionTicks([
                    "§7Automatically runs this function.",
                    "§7Minimum interval: §e4 ticks",
                    "",
                    `  §7Current: ${current}§r  `,
                    "",
                    "§eClick to edit!",
                ])
            ).toBe(5);
        }
    });

    test("reads Disabled as zero", () => {
        expect(parseAutomaticExecutionTicks(["§7Current: §cDisabled"])).toBe(0);
    });

    test("rejects missing, ambiguous, and invalid intervals", () => {
        for (const lore of [
            [],
            ["§7Minimum interval: §e5 ticks"],
            ...[
                "",
                "Enabled",
                "Every 5 to 10 ticks",
                "-5 ticks",
                "+5 ticks",
                "5.5 ticks",
                ".5 ticks",
                "9007199254740992 ticks",
            ].map((value) => [`§7Current: §a${value}`]),
        ]) {
            expect(() => parseAutomaticExecutionTicks(lore)).toThrow(
                "Could not read the function's automatic execution interval."
            );
        }
    });

    test("includes the trimmed raw name and lore with visible formatting codes", () => {
        // Synthetic unsupported state; this does not assert Housing's ON format.
        expect(() =>
            parseAutomaticExecutionTicks(
                ["  §7Example interval setting.  ", "", " §7Current: §aUnknown state "],
                "  §aAutomatic Execution  "
            )
        ).toThrow(
            'Could not read the function\'s automatic execution interval. ' +
                '{"name":"\\u00a7aAutomatic Execution","lore":' +
                '["\\u00a77Example interval setting.","","\\u00a77Current: \\u00a7aUnknown state"]}'
        );
    });

    test("caps the item details at 300 characters and marks truncation", () => {
        let message = "";
        try {
            parseAutomaticExecutionTicks(["§7Current: unknown", "x".repeat(1000)]);
        } catch (error) {
            if (!(error instanceof Error)) throw error;
            message = error.message;
        }
        const prefix = "Could not read the function's automatic execution interval. ";
        expect(message).toHaveLength(prefix.length + 300);
        expect(message).toContain('"name":"Automatic Execution"');
        expect(message).toContain('"lore":["\\u00a77Current: unknown"');
        expect(message.endsWith("…")).toBe(true);
    });
});
