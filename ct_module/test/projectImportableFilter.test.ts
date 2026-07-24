import { describe, expect, test } from "vitest";
import type { Importable } from "htsw/types";

import { importableMatchesFilters } from "../src/gui/left-panel/projects/filter";

function namedImportable(type: "FUNCTION" | "EVENT", name: string): Importable {
    return (type === "EVENT"
        ? { type, event: name }
        : { type, name }) as Importable;
}

describe("Projects importable filter", () => {
    test("a parent path search admits every importable", () => {
        expect(
            importableMatchesFilters(
                namedImportable("FUNCTION", "unrelated"),
                "projects/npcs/import.json",
                "NPCS"
            )
        ).toBe(true);
    });

    test("otherwise searches the importable identity", () => {
        expect(
            importableMatchesFilters(
                namedImportable("EVENT", "Player Join"),
                "projects/main/import.json",
                "join"
            )
        ).toBe(true);
        expect(
            importableMatchesFilters(
                namedImportable("FUNCTION", "setup"),
                "projects/main/import.json",
                "join"
            )
        ).toBe(false);
    });
});
