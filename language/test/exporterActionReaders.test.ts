import { beforeAll, describe, expect, it } from "vitest";
import type { Action } from "../src/types";
import { ACTION_NAMES } from "../src/types/constants";

const ACTION_TYPES = Object.keys(ACTION_NAMES) as Action["type"][];
let ACTION_DEFAULTS: Record<Action["type"], () => Action>;
let ACTION_READERS: Record<Action["type"], unknown>;

function sorted(values: string[]): string[] {
    return [...values].sort((a, b) => a.localeCompare(b));
}

beforeAll(async () => {
    (globalThis as any).Java = { type: () => class { } };
    (globalThis as any).register = () => ({});

    const module = await import("../../ct_module/src/exporter/actions");
    ACTION_DEFAULTS = module.ACTION_DEFAULTS as Record<Action["type"], () => Action>;
    ACTION_READERS = module.ACTION_READERS as Record<Action["type"], unknown>;
});

describe("Exporter action reader maps", () => {
    it("has defaults and readers for every action type", () => {
        const expectedTypes = sorted(ACTION_TYPES);
        const defaultTypes = sorted(Object.keys(ACTION_DEFAULTS));
        const readerTypes = sorted(Object.keys(ACTION_READERS));

        expect(defaultTypes).toEqual(expectedTypes);
        expect(readerTypes).toEqual(expectedTypes);
    });

    it("builds default actions with matching type discriminants", () => {
        for (const type of ACTION_TYPES) {
            const action = ACTION_DEFAULTS[type]();
            expect(action.type).toBe(type);
            expect(typeof ACTION_READERS[type]).toBe("function");
        }
    });
});
