import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Importable } from "htsw/types";

const mocks = vi.hoisted(() => ({
    readActionListFully: vi.fn(),
}));

vi.mock("@htsw/importer/housingSync/actions/hydration/run", () => ({
    readActionListFully: mocks.readActionListFully,
}));
vi.mock("@htsw/importer/importables/menus/housing", () => ({
    openMenuEditor: async () => "opened",
    openMenuElements: async () => undefined,
}));
vi.mock("@htsw/importer/importables/menus/listMenus", () => ({
    listAllMenuNames: async () => [],
}));
vi.mock("@htsw/importer/housingSync/menus/menuUtils", () => ({
    clickGoBack: async () => undefined,
}));
vi.mock("@htsw/importer/housingSync/menus/menuWait", () => ({
    waitForMenu: async () => undefined,
}));
vi.mock("../src/tasks/specifics/slots", () => ({
    getAllItemSlots: () => [
        {
            getSlotId: () => 0,
            getItem: () => ({
                getLore: () => [],
                getName: () => "First Button",
            }),
        },
        {
            getSlotId: () => 1,
            getItem: () => ({
                getLore: () => [],
                getName: () => "Second Button",
            }),
        },
    ],
}));
vi.mock("@htsw/importer/housingSync/items/itemNbt", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@htsw/importer/housingSync/items/itemNbt")>()),
    snbtFromItem: () => "{}",
}));
vi.mock("../src/housingSync/items/playerInventory", () => ({
    snapshotPlayerInventory: () => null,
    restorePlayerInventory: async () => undefined,
}));

import { createDiffProgressSession } from "@htsw/importer/runtime/diffProgress";
import { previewLinesForFile, resetPreview } from "../src/gui/right-panel/import-tab/livePreview";
import {
    clearTaskProgress,
    getActiveTaskListLabel,
    getActiveTaskPath,
} from "@htsw/importer/runtime/taskProgress";
import type { SyncEventHandler } from "@htsw/importer/housingSync/syncEvents";
import { ActionListPath, ActionPath } from "@htsw/importer/housingSync/actionPath";
import { readMenus } from "@htsw/importer/importables/menus/readHouseMenus";
import type TaskContext from "@htsw/importer/tasks/context";
import { message } from "./utils";

const MANIFEST = "./project/import.json";

function sourceMenu(): Importable {
    return {
        type: "MENU",
        name: "Example",
        slots: [
            {
                slot: 0,
                nbt: {} as never,
                actions: [message("source")],
            },
        ],
    };
}

describe("diff menu preview", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearTaskProgress();
        vi.stubGlobal("Player", {
            getName: () => "tester",
            getContainer: () => ({
                getSize: () => 38,
                click: () => undefined,
            }),
        });
        let listIndex = 0;
        mocks.readActionListFully.mockImplementation(
            async (
                _ctx: unknown,
                options: { events?: SyncEventHandler }
            ) => {
                options.events?.emit({
                    kind: "readStarted",
                    listPath: ActionListPath.root(),
                });
                if (listIndex === 1) {
                    expect(getActiveTaskListLabel()).toBe("Slot 1");
                    expect(previewLinesForFile(getActiveTaskPath()!)).toEqual([]);
                }
                const observed = message(`observed ${listIndex}`);
                options.events?.emit({
                    kind: "observedSnapshot",
                    nodes: [{ kind: "action", action: observed }],
                });
                if (listIndex === 0) {
                    options.events?.emit({
                        kind: "actionReadCompleted",
                        path: ActionPath.fromParts([0]),
                        hydrated: false,
                    });
                }
                listIndex++;
                return [observed];
            }
        );
    });

    afterEach(() => {
        const path = getActiveTaskPath();
        clearTaskProgress();
        if (path !== null) resetPreview(path);
        vi.unstubAllGlobals();
    });

    test("clears and identifies each menu slot preview", async () => {
        const progress = createDiffProgressSession([sourceMenu()], MANIFEST);
        progress.start();

        await readMenus(
            {
                checkCancelled: () => undefined,
                displayMessage: () => undefined,
            } as unknown as TaskContext,
            {
                importJsonPath: MANIFEST,
                rootDir: "",
                names: ["Example"],
                quiet: true,
                progress: progress.sinkFor("MENU"),
                output: {
                    kind: "memory",
                    housingUuid: "house",
                    accept: () => undefined,
                },
            }
        );

        const path = getActiveTaskPath();
        expect(path).toContain(".live-menu-0.htsl");
        expect(getActiveTaskListLabel()).toBe("Slot 1");
        expect(
            previewLinesForFile(path!)
                .map((line) => line.tokens.map((token) => token.text).join(""))
                .join("")
        ).toContain("observed 1");
        expect(previewLinesForFile(path!)[0].completed).toBeUndefined();
        expect(mocks.readActionListFully).toHaveBeenCalledTimes(2);

        progress.clear();
    });
});

import { readSessions } from "@htsw/importer/runtime/readProgress";
import { createReadLivePreview } from "../src/gui/right-panel/import-tab/readLivePreview";
readSessions.observe(({ type, basePath, observe }) => observe(createReadLivePreview(type, basePath)));
