import { beforeEach, describe, expect, test, vi } from "vitest";

import { detectHousingUuid } from "../src/importCache/housingId";
import {
    getHousingPresence,
    reportHousingPresence,
    resetHousingPresence,
} from "../src/importCache/housingPresence";
import type TaskContext from "../src/tasks/context";

beforeEach(() => {
    resetHousingPresence();
});

describe("Housing presence", () => {
    test("starts unknown", () => {
        expect(getHousingPresence()).toBe("unknown");
    });

    test("reports in and out verdicts", () => {
        reportHousingPresence("in");
        expect(getHousingPresence()).toBe("in");

        reportHousingPresence("out");
        expect(getHousingPresence()).toBe("out");
    });

    test("resets to unknown", () => {
        reportHousingPresence("in");
        resetHousingPresence();

        expect(getHousingPresence()).toBe("unknown");
    });

    test.each([
        [
            "You are currently playing on 12345678-1234-1234-1234-123456789abc ...",
            "12345678-1234-1234-1234-123456789abc",
            "in",
        ],
        ["Unknown command. Type /help for help.", null, "out"],
    ] as const)("detectHousingUuid reports %s", async (message, uuid, presence) => {
        const ctx = {
            runCommand: vi.fn().mockResolvedValue(undefined),
            waitFor: vi.fn().mockResolvedValue([message]),
            withTimeout: vi.fn((promise: Promise<unknown>) => promise),
        } as unknown as TaskContext;

        await expect(detectHousingUuid(ctx)).resolves.toBe(uuid);
        expect(getHousingPresence()).toBe(presence);
    });
});
