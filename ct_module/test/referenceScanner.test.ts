import { describe, expect, it } from "vitest";

import type { Action, Importable } from "htsw/types";
import { collectReferencedImportables } from "../src/importables/import/referenceScanner";

function fn(actions: Action[]): Importable {
    return { type: "FUNCTION", name: "f", actions } as unknown as Importable;
}

describe("collectReferencedImportables", () => {
    it("collects immediate child references and region conditions", () => {
        const actions = [
            {
                type: "CONDITIONAL",
                conditions: [{ type: "IS_IN_REGION", region: "arena" }],
                ifActions: [{ type: "FUNCTION", function: "onEnter" }],
                elseActions: [{ type: "SET_MENU", menu: "shop" }],
            },
        ] as unknown as Action[];
        const refs = collectReferencedImportables(fn(actions));
        expect(refs.functions).toEqual(["onEnter"]);
        expect(refs.menus).toEqual(["shop"]);
        expect(refs.regions).toEqual(["arena"]);
    });

    it("dedupes repeated references", () => {
        const actions = [
            { type: "FUNCTION", function: "tick" },
            { type: "FUNCTION", function: "tick" },
            { type: "SET_MENU", menu: "shop" },
            { type: "SET_MENU", menu: "shop" },
        ] as unknown as Action[];
        const refs = collectReferencedImportables(fn(actions));
        expect(refs.functions).toEqual(["tick"]);
        expect(refs.menus).toEqual(["shop"]);
    });

    it("dedupes Housing names case-insensitively", () => {
        const actions = [
            { type: "FUNCTION", function: "Tick" },
            { type: "FUNCTION", function: "tick" },
            { type: "SET_MENU", menu: "Shop" },
            { type: "SET_MENU", menu: "shop" },
        ] as unknown as Action[];
        const refs = collectReferencedImportables(fn(actions));
        expect(refs.functions).toEqual(["Tick"]);
        expect(refs.menus).toEqual(["Shop"]);
    });

    it("keeps names that collide with Object.prototype keys", () => {
        const actions = [
            { type: "FUNCTION", function: "toString" },
            { type: "FUNCTION", function: "constructor" },
        ] as unknown as Action[];
        const refs = collectReferencedImportables(fn(actions));
        expect(refs.functions).toEqual(["toString", "constructor"]);
    });

    it("walks region enter/exit and menu slot actions", () => {
        const region = {
            type: "REGION",
            name: "r",
            onEnterActions: [{ type: "FUNCTION", function: "enter" }],
            onExitActions: [{ type: "FUNCTION", function: "exit" }],
        } as unknown as Importable;
        expect(collectReferencedImportables(region).functions).toEqual(["enter", "exit"]);

        const menu = {
            type: "MENU",
            name: "m",
            slots: [{ slot: 0, actions: [{ type: "FUNCTION", function: "click" }] }],
        } as unknown as Importable;
        expect(collectReferencedImportables(menu).functions).toEqual(["click"]);
    });
});
