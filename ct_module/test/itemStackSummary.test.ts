import { afterEach, describe, expect, test, vi } from "vitest";

import { summarizeItemStack } from "../src/runtimeDebug/itemStackSummary";
import { menuItemDebugSnapshot } from "../src/tasks/specifics/slots";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("item registry diagnostics", () => {
    test.each(["registered", "missing item", "missing key", "registry error"])(
        "%s uses the 1.8.9 registry and preserves absent IDs",
        (scenario) => {
            const item = {};
            const lookup = vi.fn((_item: unknown) => {
                if (scenario === "registry error")
                    throw new Error("registry unavailable");
                return scenario === "missing key"
                    ? null
                    : { toString: () => "minecraft:obsidian" };
            });
            // Deliberately expose only the 1.8.9 method.
            const originalType = Java.type;
            vi.spyOn(Java, "type").mockImplementation((name: string) =>
                name === "net.minecraft.item.Item"
                    ? { field_150901_e: { func_177774_c: lookup } }
                    : (originalType(name) as unknown)
            );
            const stack = {
                func_77973_b: () => (scenario === "missing item" ? null : item),
                func_82833_r: () => "Obsidian",
                func_77960_j: () => 0,
                field_77994_a: 64,
                func_77978_p: () => null,
            };
            vi.stubGlobal("Player", {
                getContainer: () => ({
                    getSize: () => 37,
                    getStackInSlot: () => ({
                        itemStack: stack,
                        getName: () => "Obsidian",
                        getLore: () => [],
                    }),
                }),
            });
            const expectedId = scenario === "registered" ? "minecraft:obsidian" : null;
            expect(summarizeItemStack(stack)).toMatchObject({
                id: expectedId,
                damage: 0,
                count: 64,
            });
            expect(menuItemDebugSnapshot()[0].id).toBe(expectedId ?? undefined);
            if (scenario === "missing item") expect(lookup).not.toHaveBeenCalled();
            else expect(lookup).toHaveBeenCalledWith(item);
        }
    );
});
