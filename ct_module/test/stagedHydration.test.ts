import { afterEach, describe, expect, it, vi } from "vitest";

import {
    readStagedActionListHydration,
    writeStagedActionListHydration,
} from "../src/importCache/stagedHydration";
import {
    actionListContentHashFromActions,
    actionListScanHashFromActions,
} from "../src/housingSync/actions/scanHash";
import { message } from "./utils";

const mocks = vi.hoisted(() => ({
    atomicWriteText: vi.fn((_path: string, _content: string) => true),
}));

vi.mock("../src/utils/filesystem", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/utils/filesystem")>()),
    atomicWriteText: mocks.atomicWriteText,
}));

afterEach(() => {
    vi.unstubAllGlobals();
    mocks.atomicWriteText.mockClear();
});

describe("staged hydration cache", () => {
    it("writes a per-house, per-list snapshot with both hashes", () => {
        const actions = [message("live")];

        expect(
            writeStagedActionListHydration(
                "house",
                "FUNCTION",
                "Debug",
                "actions",
                actions
            )
        ).toBe(true);
        const [path, raw] = mocks.atomicWriteText.mock.calls[0];
        expect(path).toBe(
            "./htsw/.cache/house/function/Debug.actions.hydration.json"
        );
        expect(JSON.parse(raw)).toMatchObject({
            scanHash: actionListScanHashFromActions(actions),
            contentHash: actionListContentHashFromActions(actions),
            actions,
        });
    });

    it("rejects a snapshot whose content no longer matches its hashes", () => {
        const actions = [message("live")];
        vi.stubGlobal("FileLib", {
            exists: () => true,
            read: () =>
                JSON.stringify({
                    schemaVersion: 1,
                    scanHashVersion: 1,
                    contentHashVersion: 1,
                    writtenAt: "now",
                    scanHash: actionListScanHashFromActions(actions),
                    contentHash: actionListContentHashFromActions(actions),
                    actions: [message("tampered")],
                }),
        });

        expect(
            readStagedActionListHydration(
                "house",
                "FUNCTION",
                "Debug",
                "actions"
            )
        ).toBeNull();
    });
});
