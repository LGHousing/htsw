import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Importable } from "htsw/types";

const mocks = vi.hoisted(() => ({
    readActionListFully: vi.fn(),
}));

vi.mock("../src/housingSync/actions/hydration/run", () => ({
    readActionListFully: mocks.readActionListFully,
}));
vi.mock("../src/importables/menus/housing", () => ({
    openMenuEditor: async () => "opened",
    openMenuElements: async () => undefined,
}));
vi.mock("../src/importables/menus/listMenus", () => ({
    listAllMenuNames: async () => [],
}));
vi.mock("../src/housingSync/menus/menuUtils", () => ({
    clickGoBack: async () => undefined,
}));
vi.mock("../src/housingSync/menus/menuWait", () => ({
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
vi.mock("../src/housingSync/items/itemNbt", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/housingSync/items/itemNbt")>()),
    snbtFromItem: () => "{}",
}));
vi.mock("../src/housingSync/items/playerInventory", () => ({
    snapshotPlayerInventory: () => null,
    restorePlayerInventory: async () => undefined,
}));

import { createDiffProgressSession } from "../src/gui/right-panel/import-tab/diffProgress";
import { previewLinesForFile, resetPreview } from "../src/gui/right-panel/import-tab/livePreview";
import {
    clearTaskProgress,
    getActiveTaskListLabel,
    getActiveTaskPath,
} from "../src/gui/right-panel/import-tab/taskProgress";
import type { SyncEventHandler } from "../src/housingSync/syncEvents";
import { ActionListPath, ActionPath } from "../src/housingSync/actionPath";
import { readMenus } from "../src/importables/menus/readHouseMenus";
import type TaskContext from "../src/tasks/context";
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
