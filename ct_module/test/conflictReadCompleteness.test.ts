import { describe, expect, it, vi } from "vitest";
import type { Action } from "htsw/types";
import type { ItemSlot } from "../src/tasks/specifics/slots";
import type { ActionSyncContext } from "../src/housingSync/actions/syncContext";
import {
    actionListContentHashFromActions,
    actionListScanHashFromActions,
} from "../src/housingSync/actions/scanHash";
import { readConditionList } from "../src/housingSync/actions/conditions/readList";
import { readActionListPlan } from "../src/housingSync/actions/plan";
import { conditional } from "./utils";

vi.mock("../src/housingSync/menus/menuWait", () => ({
    timedWaitForMenu: vi.fn(async () => undefined),
    waitForMenu: vi.fn(async () => undefined),
}));

const target = { type: "FUNCTION", identity: "Proof", basePath: "actions" } as const;
const kill: Action = { type: "KILL" };
const heal: Action = { type: "HEAL" };

function session(baseline: Action[]): ActionSyncContext {
    // Only the lock and conflict state are used by these reads.
    return {
        canonicalizeItemName: (name: string) => name,
        itemRead: { mode: "sync" },
        overwriteWarningMode: "always",
        conflicts: [],
        conflictEvidence: [],
        trust: {
            trustMode: true,
            importables: new Map([
                [
                    "FUNCTION:Proof",
                    {
                        lockListScanHashes: {
                            actions: actionListScanHashFromActions(baseline),
                        },
                        lockListContentHashes: {
                            actions: actionListContentHashFromActions(baseline),
                        },
                    },
                ],
            ]),
        },
    } as unknown as ActionSyncContext;
}

function slot(id: number, name: string, lore: string[] = [], click = () => {}) {
    return {
        getSlotId: () => id,
        getItem: () => ({ getName: () => name, getLore: () => lore }),
        click,
    } as unknown as ItemSlot;
}

type Menu = {
    title: string;
    entries: (page: number) => ItemSlot[];
    fields?: () => Record<string, ItemSlot>;
    pages?: number;
    unnumberedFirstPage?: boolean;
    missingNext?: () => boolean;
    onPrevious?: () => void;
};

function menus(root: Menu) {
    let current = root;
    let page = 1;
    const parents: Array<{ menu: Menu; page: number }> = [];
    const open = (menu: Menu) => {
        parents.push({ menu: current, page });
        current = menu;
        page = 1;
    };
    const controls = () => [
        ...(page > 1
            ? [
                  slot(45, "Previous Page", [], () => {
                      page--;
                      current.onPrevious?.();
                  }),
              ]
            : []),
        ...(page < (current.pages ?? 1) && !current.missingNext?.()
            ? [
                  slot(53, "Next Page", [], () => {
                      page++;
                  }),
              ]
            : []),
    ];
    const ctx = {
        getOpenContainerTitle: () =>
            current.pages === undefined || (page === 1 && current.unnumberedFirstPage)
                ? current.title
                : `(${page}/${current.pages}) ${current.title}`,
        getAllItemSlots: () => current.entries(page).slice((page - 1) * 21, page * 21),
        tryGetItemSlot: (matches: (item: ItemSlot) => boolean) =>
            controls().find(matches) ?? null,
        getItemSlot: (matches: (item: ItemSlot) => boolean) => {
            const found = ctx.tryGetItemSlot(matches);
            if (found === null) throw new Error("Missing page control");
            return found;
        },
        tryGetMenuItemSlot: (label: string) => {
            if (label !== "Go Back") return current.fields?.()[label] ?? null;
            return slot(49, "Go Back", [], () => {
                const parent = parents.pop()!;
                current = parent.menu;
                page = parent.page;
            });
        },
        getMenuItemSlot: (label: string) => {
            const found = ctx.tryGetMenuItemSlot(label);
            if (found === null) throw new Error(`Missing ${label}`);
            return found;
        },
    };
    return { ctx, open };
}

function actionSlots(actions: Action[]) {
    return actions.map((action, index) =>
        slot(
            10 + Math.floor((index % 21) / 7) * 9 + (index % 7),
            action.type === "KILL" ? "Kill Player" : "Full Heal"
        )
    );
}

function read(
    ctx: ReturnType<typeof menus>["ctx"],
    sync: ActionSyncContext,
    baseline: Action[]
) {
    return readActionListPlan(ctx as never, [], {
        sync,
        baselineCurrent: baseline,
        conflictTarget: target,
    });
}

describe("full conflict re-read completeness", () => {
    it.each(["short first page", "empty final page"])(
        "keeps the conflict when a %s hides an extra HEAL",
        async (incomplete) => {
            const baseline = [...Array<Action>(20).fill(heal), kill];
            const live = [...Array<Action>(21).fill(heal), kill];
            let rereading = false;
            const ui = menus({
                title: "Actions: Proof",
                pages: 2,
                entries: (page) => {
                    if (!rereading) return actionSlots(live);
                    if (incomplete === "empty final page") {
                        return page === 1
                            ? actionSlots(baseline)
                            : [...actionSlots(baseline), slot(10, "No Actions!")];
                    }
                    return actionSlots(page === 1 ? baseline.slice(0, 20) : live);
                },
                onPrevious: () => {
                    rereading = true;
                },
            });
            const sync = session(baseline);
            await expect(read(ui.ctx, sync, baseline)).rejects.toThrow(
                "Incomplete paginated action list"
            );
            expect(sync.conflicts).toEqual([target]);
        }
    );

    it.each([1, 21, 42])(
        "keeps the conflict when a re-read changes an entry type among %i entries",
        async (count) => {
            const baseline = Array<Action>(count).fill(heal);
            const live = [...baseline.slice(0, -1), kill];
            let rereading = false;
            let scans = 0;
            const ui = menus({
                title: "Actions: Proof",
                pages: Math.ceil(count / 21),
                entries: () => {
                    scans++;
                    return actionSlots(
                        rereading || (count <= 21 && scans > 1) ? baseline : live
                    );
                },
                onPrevious: () => {
                    rereading = true;
                },
            });
            const sync = session(baseline);
            const plan = await read(ui.ctx, sync, baseline);
            expect(plan.observed.map((entry) => entry.action)).toEqual(baseline);
            expect(sync.conflicts).toEqual([target]);
        }
    );

    it.each([
        [1, false],
        [22, false],
        [22, true],
    ] as const)(
        "keeps the conflict when the re-read drops a trailing HEAL after %i baseline entries (unnumbered first page: %s)",
        async (count, unnumberedFirstPage) => {
            const baseline = [...Array<Action>(count - 1).fill(heal), kill];
            const live = [...baseline, heal];
            let rereading = false;
            let scans = 0;
            const ui = menus({
                title: "Actions: Proof",
                pages: Math.ceil(live.length / 21),
                unnumberedFirstPage,
                entries: () => {
                    scans++;
                    return actionSlots(
                        rereading || (count === 1 && scans > 1) ? baseline : live
                    );
                },
                onPrevious: () => {
                    rereading = true;
                },
            });
            const sync = session(baseline);
            const plan = await read(ui.ctx, sync, baseline);
            expect(plan.observed.map((entry) => entry.action)).toEqual(baseline);
            expect(sync.conflicts).toEqual([target]);
        }
    );

    it.each([
        [1, false],
        [21, false],
        [35, false],
        [42, false],
        [35, true],
    ] as const)(
        "clears a scan conflict after consistent complete reads of %i entries (unnumbered first page: %s)",
        async (count, unnumberedFirstPage) => {
            const baseline = [...Array<Action>(count - 1).fill(heal), kill];
            const ui = menus({
                title: "Actions: Proof",
                pages: Math.ceil(count / 21),
                unnumberedFirstPage,
                entries: () => actionSlots(baseline),
            });
            const sync = session(baseline);
            // The lock's scan disagrees, but both independent live reads and
            // the lock's full content agree (the Team Apply 3 recovery shape).
            sync.trust.importables.get("FUNCTION:Proof")!.lockListScanHashes = {
                actions: "different scan",
            };
            const plan = await read(ui.ctx, sync, baseline);
            expect(plan.observed.map((entry) => entry.action)).toEqual(baseline);
            expect(sync.conflicts).toEqual([]);
        }
    );

    it.each([
        "heading only",
        "missing section",
        "unreadable entry",
        "editor unavailable",
        "empty editor",
    ])(
        "preserves an added KILL when an empty baseline conditional is removed: %s",
        async (incomplete) => {
            let scans = 0;
            const childRead = vi.fn(() =>
                incomplete === "empty editor" ? [] : actionSlots([kill])
            );
            const child: Menu = { title: "If Actions", entries: childRead };
            const editor: Menu = {
                title: "Action Settings",
                entries: () => [],
                fields: () => ({
                    "Match Any Condition": slot(10, "Match Any Condition", [
                        "Current Value:",
                        "Disabled",
                    ]),
                    ...(incomplete === "editor unavailable"
                        ? {}
                        : {
                              "If Actions": slot(11, "If Actions", [], () =>
                                  ui.open(child)
                              ),
                          }),
                }),
            };
            const root: Menu = {
                title: "Actions: Proof",
                entries: () => {
                    scans++;
                    const section =
                        scans === 1
                            ? ["If Actions:", "- Kill Player"]
                            : incomplete === "missing section"
                              ? []
                              : incomplete === "unreadable entry"
                                ? ["If Actions:", "loading..."]
                                : ["If Actions:"];
                    return [
                        slot(
                            10,
                            "Conditional",
                            [
                                "Match Any Condition: Disabled",
                                "Conditions:",
                                "- None",
                                "",
                                ...section,
                                "",
                                "Else Actions:",
                                "- None",
                            ],
                            () => ui.open(editor)
                        ),
                    ];
                },
            };
            const ui = menus(root);
            const baseline = [conditional()];
            const sync = session(baseline);
            if (incomplete === "editor unavailable" || incomplete === "empty editor") {
                await expect(read(ui.ctx, sync, baseline)).rejects.toThrow(
                    incomplete === "editor unavailable"
                        ? "Missing If Actions"
                        : "Incomplete action list"
                );
            } else {
                const plan = await read(ui.ctx, sync, baseline);
                expect(childRead).toHaveBeenCalled();
                expect(plan.observed[0].action).toEqual(
                    conditional({ ifActions: [kill] })
                );
            }
            expect(sync.conflicts).toEqual([target]);
        }
    );

    it.each(["summary", "child editor"])(
        "keeps the conflict without an initial empty-list summary: %s",
        async (where) => {
            let scans = 0;
            const openEditor = vi.fn(() => ui.open(editor));
            const child: Menu = {
                title: "If Actions",
                entries: () => [slot(22, "No Actions!")],
            };
            const editor: Menu = {
                title: "Action Settings",
                entries: () => [],
                fields: () => ({
                    "Match Any Condition": slot(10, "Match Any Condition", [
                        "Current Value:",
                        "Disabled",
                    ]),
                    "If Actions": slot(11, "If Actions", [], () => ui.open(child)),
                }),
            };
            const root: Menu = {
                title: "Actions: Proof",
                entries: () => {
                    scans++;
                    return [
                        slot(
                            10,
                            "Conditional",
                            [
                                "Match Any Condition: Disabled",
                                "Conditions:",
                                "- None",
                                "",
                                "If Actions:",
                                ...(where === "summary" && scans > 1 ? ["- None"] : []),
                                "",
                                "Else Actions:",
                                "- None",
                            ],
                            openEditor
                        ),
                    ];
                },
            };
            const ui = menus(root);
            const baseline = [conditional()];
            const sync = session(baseline);
            await read(ui.ctx, sync, baseline);
            expect(sync.conflicts).toEqual([target]);
            expect(openEditor).toHaveBeenCalledTimes(where === "summary" ? 0 : 1);
        }
    );

    it("keeps the conflict when a 22-action list reappears as page 1/2 without Next", async () => {
        let rereading = false;
        const live = [...Array<Action>(21).fill(heal), kill];
        const root: Menu = {
            title: "Actions: Proof",
            pages: 2,
            entries: () => actionSlots(live),
            onPrevious: () => {
                rereading = true;
            },
            missingNext: () => rereading,
        };
        const ui = menus(root);
        const baseline = live.slice(0, 21);
        const sync = session(baseline);
        await expect(read(ui.ctx, sync, baseline)).rejects.toThrow(
            "Incomplete paginated action list"
        );
        expect(sync.conflicts).toEqual([target]);
    });

    it.each([
        "equal",
        "count mismatch",
        "outside edit",
        "missing Next",
        "short page",
        "nested conditional",
    ])(
        "checks a conditional's paginated children before clearing: %s",
        async (scenario) => {
            const baselineChildren = [...Array<Action>(21).fill(heal), kill];
            const live =
                scenario === "equal" || scenario === "nested conditional"
                    ? baselineChildren
                    : [...baselineChildren, heal];
            const child: Menu = {
                title: "If Actions",
                pages: live.length > 21 ? 2 : 1,
                entries: (page) =>
                    scenario === "nested conditional"
                        ? [
                              ...actionSlots(baselineChildren.slice(0, 21)),
                              slot(10, "Conditional", [
                                  "If Actions:",
                                  ...Array<string>(22).fill("- Full Heal"),
                              ]),
                          ]
                        : actionSlots(
                              scenario === "short page" && page === 1
                                  ? live.slice(0, 20)
                                  : scenario === "count mismatch"
                                    ? baselineChildren
                                    : live
                          ),
                missingNext: () => scenario === "missing Next",
            };
            const editor: Menu = {
                title: "Action Settings",
                entries: () => [],
                fields: () => ({
                    "Match Any Condition": slot(10, "Match Any Condition", [
                        "Current Value:",
                        "Disabled",
                    ]),
                    "If Actions": slot(11, "If Actions", [], () => ui.open(child)),
                }),
            };
            const root: Menu = {
                title: "Actions: Proof",
                entries: () => [
                    slot(
                        10,
                        "Conditional",
                        [
                            "Match Any Condition: Disabled",
                            "Conditions:",
                            "- None",
                            "",
                            "If Actions:",
                            ...live.map((action) =>
                                action.type === "KILL" ? "- Kill Player" : "- Full Heal"
                            ),
                            "",
                            "Else Actions:",
                            "- None",
                        ],
                        () => ui.open(editor)
                    ),
                ],
            };
            const ui = menus(root);
            const baseline = [conditional({ ifActions: baselineChildren })];
            const sync = session(baseline);
            if (scenario === "equal" || scenario === "nested conditional") {
                sync.trust.importables.get("FUNCTION:Proof")!.lockListScanHashes = {
                    actions: "different scan",
                };
            }
            if (
                scenario === "missing Next" ||
                scenario === "short page" ||
                scenario === "count mismatch" ||
                scenario === "nested conditional"
            ) {
                // Nested containers are unsupported; an unread inner list must
                // preserve the conflict just as an incomplete page does.
                await expect(read(ui.ctx, sync, baseline)).rejects.toThrow("Incomplete");
            } else {
                const plan = await read(ui.ctx, sync, baseline);
                expect(plan.observed[0].action).toEqual(
                    conditional({
                        ifActions: live,
                    })
                );
            }
            expect(sync.conflicts).toHaveLength(scenario === "equal" ? 0 : 1);
        }
    );
});

// A blank condition editor is also incomplete, even without pagination.
it.each([false, true])(
    "requires an explicit empty-condition placeholder: %s",
    async (placeholder) => {
        const ui = menus({
            title: "Conditions",
            entries: () => (placeholder ? [slot(22, "No Conditions!")] : []),
        });
        const result = readConditionList(ui.ctx as never, {
            itemReadMode: "sync",
            canonicalizeItemName: (name) => name,
        });
        if (placeholder) await expect(result).resolves.toEqual([]);
        else await expect(result).rejects.toThrow("Incomplete condition list");
    }
);
