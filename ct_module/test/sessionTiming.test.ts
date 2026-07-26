import { afterEach, expect, test, vi } from "vitest";

import { runHousingSyncTask } from "../src/housingSync/taskRunner";
import { getTaskElapsedMs } from "../src/gui/right-panel/import-tab/taskProgress";
import {
    getActiveTaskElapsedMs,
    getActiveTaskStartedAt,
} from "../src/tasks/activeTask";

afterEach(() => {
    vi.useRealTimers();
});

test("a second import owns a fresh session clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const first = await runHousingSyncTask("import", async (ctx) => {
        vi.setSystemTime(65_000);
        return ctx.elapsedMs();
    });

    vi.setSystemTime(100_000);
    const second = await runHousingSyncTask("import", async (ctx) => {
        expect(getActiveTaskStartedAt()).toBe(100_000);
        vi.setSystemTime(115_600);
        expect(getActiveTaskElapsedMs()).toBe(15_600);
        expect(getTaskElapsedMs()).toBe(15_600);
        return ctx.elapsedMs();
    });

    expect(first).toBe(64_000);
    expect(second).toBe(15_600);
});

test("an export after an import owns a fresh session clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    await runHousingSyncTask("import", async (ctx) => {
        vi.setSystemTime(65_000);
        expect(ctx.elapsedMs()).toBe(64_000);
    });

    vi.setSystemTime(200_000);
    const exported = await runHousingSyncTask("export", async (ctx) => {
        expect(getActiveTaskStartedAt()).toBe(ctx.startedAt);
        vi.setSystemTime(209_700);
        expect(getActiveTaskElapsedMs()).toBe(ctx.elapsedMs());
        expect(getTaskElapsedMs()).toBe(ctx.elapsedMs());
        return ctx.elapsedMs();
    });

    expect(exported).toBe(9_700);
});
