import { describe, expect, test } from "vitest";

import { parseAutomaticExecutionTicks } from "@htsw/importer/importables/functions/housing";

describe("automatic execution lore", () => {
    test("reads the interval from Housing's ON-state lore", () => {
        // Captured live on 2026-10-21 from a function set to 15 minutes.
        const lore = (current: string) => [
            "§7Functions can be enabled to",
            "§7automatically execute for all players",
            "§7in the house every X amount of ticks.",
            "§7§7TIP: 1 second is 20 ticks",
            "",
            `§7Current: ${current}`,
            "",
            "§eClick to change!",
        ];
        expect(parseAutomaticExecutionTicks(lore("§a18000 Ticks (15m00s)"))).toBe(18000);
        expect(parseAutomaticExecutionTicks(lore("§a5 Ticks (0m00s)"))).toBe(5);
        expect(parseAutomaticExecutionTicks(lore("§a5"))).toBe(5);
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
                "Every 5 ticks",
                "5 Ticks (0m00s) extra",
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
