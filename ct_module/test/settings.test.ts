import { beforeEach, describe, expect, test, vi } from "vitest";

describe("session heartbeat setting", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllGlobals();
    });

    test("defaults to on when the setting has not been persisted", async () => {
        vi.stubGlobal("FileLib", {
            exists: () => false,
            read: () => null,
            write: () => undefined,
        });
        const { getUploadSessionHeartbeat } = await import("../src/settings");

        expect(getUploadSessionHeartbeat()).toBe(true);
    });

    test("honors an explicit off value", async () => {
        vi.stubGlobal("FileLib", {
            exists: () => true,
            read: () => JSON.stringify({ uploadSessionHeartbeat: false }),
            write: () => undefined,
        });
        const { getUploadSessionHeartbeat } = await import("../src/settings");

        expect(getUploadSessionHeartbeat()).toBe(false);
    });
});
