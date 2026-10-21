import { describe, expect, test } from "vitest";

import { parseAutomaticExecutionTicks } from "@htsw/importer/importables/functions/housing";

describe("automatic execution parse diagnostics", () => {
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
