import { afterEach, describe, expect, it, vi } from "vitest";

import {
    packageBaselineAgeDays,
    readPackageBaselineStamp,
    stampPackageBaseline,
} from "../src/importables/baselineStamp";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("package baseline stamp", () => {
    it("writes and reads export time and house id", () => {
        const files: Record<string, string> = {
            "/project/import.json":
                '{\n  // Keep this project note.\n  "functions": []\n}',
        };
        vi.stubGlobal("FileLib", {
            read: (path: string) => files[path],
            write: (path: string, value: string) => {
                files[path] = value;
            },
            exists: () => true,
        });

        expect(
            stampPackageBaseline(
                "/project/import.json",
                "house",
                "2026-07-26T00:00:00.000Z"
            )
        ).toBe(true);
        expect(readPackageBaselineStamp("/project/import.json")).toEqual({
            exportedAt: "2026-07-26T00:00:00.000Z",
            houseId: "house",
        });
        expect(files["/project/import.json"]).toContain("// Keep this project note.");
    });

    it("warns only for stamped baselines older than 24 hours", () => {
        const now = Date.parse("2026-07-28T12:00:00.000Z");
        expect(packageBaselineAgeDays(null, now)).toBeUndefined();
        expect(
            packageBaselineAgeDays(
                { exportedAt: "2026-07-27T13:00:00.000Z", houseId: "house" },
                now
            )
        ).toBeUndefined();
        expect(
            packageBaselineAgeDays(
                { exportedAt: "2026-07-26T00:00:00.000Z", houseId: "house" },
                now
            )
        ).toBe(2);
    });
});
