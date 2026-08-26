import { describe, expect, test } from "vitest";

import { compareHouseRows } from "../src/gui/left-panel/houses/contentBrowser";

type Row = Parameters<typeof compareHouseRows>[0];

function row(name: string, state: Row["state"]): Row {
    return { item: { name } as Row["item"], state };
}

describe("function list order", () => {
    test("keeps alphabetical order within unmatched and matched functions", () => {
        const rows: Row[] = [
            row("Alpha", "matches-knowledge"),
            row("Delta", "house-only"),
            row("Charlie", "differs-from-knowledge"),
            row("Beta", "house-only"),
        ];

        rows.sort((a, b) => compareHouseRows(a, b, true));

        expect(rows.map((entry) => entry.item.name)).toEqual([
            "Beta",
            "Delta",
            "Alpha",
            "Charlie",
        ]);
    });

    test("keeps descending status order within both partitions", () => {
        const rows: Row[] = [
            row("Alpha", "matches-knowledge"),
            row("Delta", "house-only"),
            row("Bravo", "differs-from-knowledge"),
            row("Charlie", "house-only"),
        ];

        rows.sort((a, b) =>
            compareHouseRows(a, b, true, { id: "status", direction: "DESC" })
        );

        expect(rows.map((entry) => entry.item.name)).toEqual([
            "Delta",
            "Charlie",
            "Alpha",
            "Bravo",
        ]);
    });
});
