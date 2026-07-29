import { afterEach, describe, expect, it, vi } from "vitest";
import type { Action } from "htsw/types";

import {
    readStagedActionListHydration,
    writeStagedActionListHydration,
} from "../src/importCache/stagedHydration";
import {
    actionListContentHashFromActions,
    actionListScanHashFromActions,
} from "../src/housingSync/actions/scanHash";
import {
    itemFieldContentFromSnapshot,
    type ItemFieldContentSnapshot,
} from "../src/housingSync/items/fieldContent";
import { canonicalItemShellTagKey } from "../src/housingSync/items/itemNbt";
import type { TagLike } from "../src/housingSync/items/itemTag";
import { message } from "./utils";

const mocks = vi.hoisted(() => ({
    atomicWriteText: vi.fn((_path: string, _content: string) => true),
}));

const cookie: TagLike = {
    type: "compound",
    value: { id: { type: "string", value: "minecraft:cookie" } },
};

function giveCookie(): Action {
    return { type: "GIVE_ITEM", itemName: "cookie" };
}

function cookieFields(key = canonicalItemShellTagKey(cookie)): ItemFieldContentSnapshot {
    return { cookie: { key, tag: cookie } };
}

vi.mock("../src/utils/filesystem", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/utils/filesystem")>()),
    atomicWriteText: mocks.atomicWriteText,
}));

afterEach(() => {
    vi.useRealTimers();
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
            itemFields: {},
        });
    });

    it("rejects a snapshot whose content no longer matches its hashes", () => {
        const actions = [giveCookie(), message("live")];
        const itemFields = cookieFields();
        vi.stubGlobal("FileLib", {
            exists: () => true,
            read: () =>
                JSON.stringify({
                    schemaVersion: 2,
                    scanHashVersion: 1,
                    contentHashVersion: 2,
                    writtenAt: new Date().toISOString(),
                    scanHash: actionListScanHashFromActions(actions),
                    contentHash: actionListContentHashFromActions(
                        actions,
                        itemFieldContentFromSnapshot(itemFields)
                    ),
                    actions: [giveCookie(), message("tampered")],
                    itemFields,
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

    it("rejects an item field whose key does not match its tag", () => {
        const actions = [giveCookie()];
        const itemFields = cookieFields("inconsistent");
        vi.stubGlobal("FileLib", {
            exists: () => true,
            read: () =>
                JSON.stringify({
                    schemaVersion: 2,
                    scanHashVersion: 1,
                    contentHashVersion: 2,
                    writtenAt: new Date().toISOString(),
                    scanHash: actionListScanHashFromActions(actions),
                    contentHash: actionListContentHashFromActions(
                        actions,
                        itemFieldContentFromSnapshot(itemFields)
                    ),
                    actions,
                    itemFields,
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

    it("rejects a snapshot more than ten minutes old", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-07-28T12:10:00.001Z"));
        const actions = [message("live")];
        vi.stubGlobal("FileLib", {
            exists: () => true,
            read: () =>
                JSON.stringify({
                    schemaVersion: 1,
                    scanHashVersion: 1,
                    contentHashVersion: 1,
                    writtenAt: "2026-07-28T12:00:00.000Z",
                    scanHash: actionListScanHashFromActions(actions),
                    contentHash: actionListContentHashFromActions(actions),
                    actions,
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
