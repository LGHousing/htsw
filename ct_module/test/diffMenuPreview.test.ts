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
                getName: () => "Preview Button",
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
import { clearHousingOperationProgress } from "../src/gui/right-panel/import-tab/housingOperationProgress";
import { previewLinesForFile, resetPreview } from "../src/gui/right-panel/import-tab/livePreview";
import { getActiveTaskPath } from "../src/gui/right-panel/import-tab/taskProgress";
import type { SyncEventHandler } from "../src/housingSync/syncEvents";
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
        clearHousingOperationProgress();
        vi.stubGlobal("Player", {
            getName: () => "tester",
            getContainer: () => ({
                getSize: () => 37,
                click: () => undefined,
            }),
        });
        mocks.readActionListFully.mockImplementation(
            async (
                _ctx: unknown,
                options: { events?: SyncEventHandler }
            ) => {
                const observed = message("observed");
                options.events?.emit({
                    kind: "observedSnapshot",
                    nodes: [{ kind: "action", action: observed }],
                });
                return [observed];
            }
        );
    });

    afterEach(() => {
        const path = getActiveTaskPath();
        clearHousingOperationProgress();
        if (path !== null) resetPreview(path);
        vi.unstubAllGlobals();
    });

    test("forwards menu action snapshots into the active diff preview", async () => {
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
        expect(
            previewLinesForFile(path!)
                .map((line) => line.tokens.map((token) => token.text).join(""))
                .join("")
        ).toContain("observed");
        expect(mocks.readActionListFully).toHaveBeenCalledOnce();

        progress.clear();
    });
});
