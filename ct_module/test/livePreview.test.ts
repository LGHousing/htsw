import { beforeEach, describe, expect, test } from "vitest";
import type { Action, Importable } from "htsw/types";

import {
    activatePreview,
    applyComplete,
    buildObservedToDesiredIndexMap,
    disposeLivePreviews,
    finalizeFromSource,
    getCurrentOperation,
    getCurrentPath,
    livePreviewCacheTelemetry,
    livePreviewCacheSize,
    markHeadApplied,
    markPreviewCompleted,
    markReadComplete,
    markPlannedAdd,
    markPlannedDelete,
    markPlannedEdit,
    markPlannedMove,
    previewLineIdForPath,
    previewLinesForFile,
    previewRevision,
    primeWithCache,
    rebaseToDesired,
    resetPreview,
    setObservedTopLevel,
    setCurrentOperation,
    type PreviewLine,
} from "../src/gui/right-panel/import-tab/livePreview";
import {
    getActiveTaskListLabel,
    getActiveTaskPath,
} from "../src/gui/right-panel/import-tab/taskProgress";
import { createReadLivePreview } from "../src/gui/right-panel/import-tab/readLivePreview";
import { createImportPreviewReplay } from "../src/gui/right-panel/import-tab/importPreviewReplay";
import {
    ActionListPath,
    type ActionPathPart,
    ActionPath,
} from "../src/housingSync/actionPath";
import type { ObservedNode } from "../src/housingSync/observedActions";
import type { PlannedOp } from "../src/housingSync/syncEvents";

import { conditional, message } from "./utils";

const PATH = "./test.htsl";

function p(...parts: ActionPathPart[]) {
    return ActionPath.fromParts(parts);
}

function ids(): string[] {
    return previewLinesForFile(PATH).map((l) => l.id);
}

function bodyAt(...parts: ActionPathPart[]): PreviewLine | undefined {
    const path = ActionPath.fromParts(parts);
    return previewLinesForFile(PATH).find(
        (line) =>
            line.variant === "body" &&
            line.actionPath?.kind === "action" &&
            ActionPath.equals(line.actionPath, path)
    );
}

function func(actions: Action[]): Importable {
    return { type: "FUNCTION", name: "test", actions };
}

function nodes(...actions: Action[]): ObservedNode[] {
    return actions.map((action) => ({ kind: "action", action }));
}

function conditionalSummary(actionCount: number): ObservedNode {
    return {
        kind: "partial",
        type: "CONDITIONAL",
        action: conditional({}),
        childLists: {
            ifActions: {
                state: "summary",
                types: Array(actionCount).fill("MESSAGE"),
            },
        },
    };
}

beforeEach(() => {
    disposeLivePreviews();
});

describe("primeWithCache + previewLinesForFile", () => {
    test("empty importable yields no lines", () => {
        primeWithCache(PATH, null);
        expect(previewLinesForFile(PATH)).toEqual([]);
    });

    test("function with one action gets one :body line", () => {
        primeWithCache(PATH, func([message("hi")]));
        expect(ids()).toEqual(["0:body"]);
    });

    test("reports retained preview weight", () => {
        primeWithCache(PATH, func([message("cached")]));
        setObservedTopLevel(PATH, nodes(message("observed")));
        setObservedTopLevel(PATH, nodes(message("pending one"), message("pending two")));

        const retainedLines = previewLinesForFile(PATH);
        expect(livePreviewCacheTelemetry()).toEqual({
            states: 1,
            lines: retainedLines.length,
            tokens: retainedLines.reduce((sum, line) => sum + line.tokens.length, 0),
            pendingNodes: 2,
        });
    });

    test("keeps at most 16 rendered file previews", () => {
        const paths: string[] = [];
        for (let i = 0; i < 20; i++) {
            const path = `./function-${i}.htsl`;
            paths.push(path);
            primeWithCache(path, func([message(String(i))]));
        }

        for (const path of paths.slice(-16)) {
            expect(previewLinesForFile(path).map((line) => line.id)).toEqual(["0:body"]);
        }
        expect(previewLinesForFile(paths[0])).toEqual([]);
        expect(livePreviewCacheSize()).toBe(16);
    });

    test("releases a successful preview when the next preview becomes active", () => {
        for (let i = 0; i < 130; i++) {
            const path = `./large-import-${i}.htsl`;
            activatePreview(path);
            primeWithCache(path, func([message(String(i))]));
            if (i < 129) markPreviewCompleted(path);
        }

        expect(previewLinesForFile("./large-import-0.htsl")).toEqual([]);
        expect(livePreviewCacheSize()).toBe(1);
        expect(
            previewLinesForFile("./large-import-129.htsl").map((line) => line.id)
        ).toEqual(["0:body"]);
    });

    test("CONDITIONAL renders head + close with stable ids", () => {
        primeWithCache(
            PATH,
            func([conditional({ ifActions: [message("child")], elseActions: [] })])
        );
        expect(ids()).toEqual(["0:body", "0.ifActions.0:body", "0:close"]);
    });

    test("CONDITIONAL with else renders body, :else, close", () => {
        primeWithCache(
            PATH,
            func([
                conditional({
                    ifActions: [message("a")],
                    elseActions: [message("b")],
                }),
            ])
        );
        expect(ids()).toEqual([
            "0:body",
            "0.ifActions.0:body",
            "0:else",
            "0.elseActions.0:body",
            "0:close",
        ]);
    });

    test("child CONDITIONAL preserves dotted paths", () => {
        primeWithCache(
            PATH,
            func([
                conditional({
                    ifActions: [conditional({ ifActions: [message("deep")] })],
                }),
            ])
        );
        expect(ids()).toContain("0.ifActions.0.ifActions.0:body");
    });
});

describe("setObservedTopLevel", () => {
    test("replaces line list with observed actions", () => {
        primeWithCache(PATH, func([message("old")]));
        setObservedTopLevel(PATH, nodes(message("a"), message("b")));
        expect(ids()).toEqual(["0:body", "1:body"]);
    });

    test("null child entries render as a collapsed placeholder", () => {
        setObservedTopLevel(PATH, [conditionalSummary(3)]);
        const line = previewLinesForFile(PATH).find(
            (l) => l.id === "0.ifActions:placeholder"
        );
        expect(line).toBeDefined();
        expect(line!.variant).toBe("placeholder");
        // The text reports the count so the user sees how big the unhydrated body is.
        expect(line!.tokens.map((t) => t.text).join("")).toContain("3 actions");
    });

    test("preserves completed reads across later snapshots", () => {
        setObservedTopLevel(PATH, nodes(message("a"), message("b")));
        markReadComplete(PATH, p(0));
        setObservedTopLevel(PATH, nodes(message("updated"), message("b")), {
            force: true,
        });

        expect(bodyAt(0)?.completed).toBe(true);
        expect(bodyAt(1)?.completed).toBeUndefined();
    });

    test("does not complete unresolved placeholders with their parent", () => {
        setObservedTopLevel(PATH, [conditionalSummary(1)]);
        markReadComplete(PATH, p(0));

        const placeholder = previewLinesForFile(PATH).find(
            (line) => line.variant === "placeholder"
        );
        expect(placeholder?.completed).toBeUndefined();
    });
});

describe("read live preview", () => {
    test("restores the right importable when source paths are shared", () => {
        const sharedPath = "./project/import.json";
        const replay = createImportPreviewReplay(false);

        primeWithCache(sharedPath, func([message("cached-a")]));
        replay.start("a", sharedPath, func([message("cached-a")]));
        const observedA = nodes(message("observed-a"));
        replay.observe("a", observedA);
        setObservedTopLevel(sharedPath, observedA, { force: true });

        primeWithCache(sharedPath, func([message("cached-b")]));
        replay.start("b", sharedPath, func([message("cached-b")]));
        setObservedTopLevel(sharedPath, nodes(message("observed-b")), { force: true });

        replay.restore("a", sharedPath);

        expect(
            previewLinesForFile(sharedPath)[0]
                .tokens.map((token) => token.text)
                .join("")
        ).toBe('chat "observed-a"');
    });

    test("does not carry completion state between menu slot action lists", () => {
        const preview = createReadLivePreview("MENU", "./project/import.json");
        preview.start(["menu"]);
        preview.activate(0, true);
        const path = getActiveTaskPath()!;

        preview.events.emit({
            kind: "readStarted",
            listPath: ActionListPath.root(),
        });
        preview.events.emit({
            kind: "observedSnapshot",
            nodes: nodes(message("first slot")),
        });
        preview.events.emit({
            kind: "actionReadCompleted",
            path: p(0),
            hydrated: false,
        });
        expect(previewLinesForFile(path)[0].completed).toBe(true);

        preview.events.emit({
            kind: "readStarted",
            listPath: ActionListPath.root(),
        });
        preview.events.emit({
            kind: "observedSnapshot",
            nodes: nodes(message("second slot")),
        });

        expect(previewLinesForFile(path)[0].completed).toBeUndefined();
        preview.clear();
    });

    test("keeps staged scanning within the preview cache bound and rebuilds an evicted item", () => {
        const names = Array.from({ length: 512 }, (_value, index) => String(index));
        const preview = createReadLivePreview("FUNCTION", "./project/import.json");
        preview.start(names);

        for (let i = 0; i < names.length; i++) {
            preview.activate(i, true);
            preview.events.emit({
                kind: "observedSnapshot",
                nodes: nodes(message(`scan-${i}`)),
            });
        }

        expect(livePreviewCacheSize()).toBe(16);
        preview.activate(0, false);
        expect(
            previewLinesForFile(getActiveTaskPath()!).map((line) =>
                line.tokens.map((token) => token.text).join("")
            )
        ).toEqual(['chat "scan-0"']);
        preview.clear();
    });

    test("keeps a menu-heavy sibling read in one preview state", () => {
        const preview = createReadLivePreview("MENU", "./project/import.json");
        preview.start(["menu"]);
        preview.activate(0, true);

        for (let slot = 0; slot < 512; slot++) {
            const events = preview.eventsForList(`Slot ${slot}`);
            events.emit({
                kind: "readStarted",
                listPath: ActionListPath.root(),
            });
            expect(previewLinesForFile(getActiveTaskPath()!)).toEqual([]);
            events.emit({
                kind: "observedSnapshot",
                nodes: nodes(message(`slot-${slot}`)),
            });
        }

        expect(livePreviewCacheSize()).toBe(1);
        expect(getActiveTaskListLabel()).toBe("Slot 511");
        preview.clear();
    });

    test("releases a completed export preview when the operation clears", () => {
        const preview = createReadLivePreview("FUNCTION", "./project/import.json");
        preview.start(["a"]);
        preview.activate(0, true);
        preview.events.emit({
            kind: "observedSnapshot",
            nodes: nodes(message("done")),
        });
        preview.finish(0);

        expect(livePreviewCacheSize()).toBe(1);
        preview.clear();
        expect(livePreviewCacheSize()).toBe(0);
    });

    test("shows the shallow scan, follows hydration, and forces the final snapshot", () => {
        const preview = createReadLivePreview("FUNCTION", "./project/import.json");
        preview.start(["a"]);
        preview.activate(0, true);
        const path = getActiveTaskPath();
        expect(path).not.toBeNull();

        preview.events.emit({
            kind: "observedSnapshot",
            nodes: [conditionalSummary(2)],
        });
        expect(previewLinesForFile(path!)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: "0.ifActions:placeholder",
                    variant: "placeholder",
                }),
            ])
        );

        preview.events.emit({
            kind: "childListReadStarted",
            path: p(0),
            actionType: "CONDITIONAL",
        });
        expect(getCurrentPath(path!)).toEqual(p(0));

        preview.events.emit({
            kind: "observedSnapshot",
            nodes: nodes(conditional({ ifActions: [message("hydrated")] })),
        });
        preview.events.emit({
            kind: "actionReadCompleted",
            path: p(0),
            hydrated: true,
        });
        preview.finish(0);

        expect(previewLinesForFile(path!).map((line) => line.id)).toEqual([
            "0:body",
            "0.ifActions.0:body",
            "0:close",
        ]);
        expect(previewLinesForFile(path!).every((line) => line.completed)).toBe(true);
        expect(getCurrentPath(path!)).toBeNull();
        preview.clear();
    });

    test("colors shallow actions as soon as their scan completes", () => {
        const preview = createReadLivePreview("FUNCTION", "./project/import.json");
        preview.start(["a"]);
        preview.activate(0, true);
        const path = getActiveTaskPath()!;

        preview.events.emit({
            kind: "observedSnapshot",
            nodes: nodes(message("ready"), message("pending")),
        });
        preview.events.emit({
            kind: "actionReadCompleted",
            path: p(0),
            hydrated: false,
        });

        const lines = previewLinesForFile(path);
        expect(
            lines.find(
                (line) =>
                    line.actionPath?.kind === "action" &&
                    ActionPath.equals(line.actionPath, p(0))
            )?.completed
        ).toBe(true);
        expect(
            lines.find(
                (line) =>
                    line.actionPath?.kind === "action" &&
                    ActionPath.equals(line.actionPath, p(1))
            )?.completed
        ).toBeUndefined();
        preview.clear();
    });
});

describe("markPlannedAdd", () => {
    test("inserts a pending-add line with the pending: prefix", () => {
        primeWithCache(PATH, func([]));
        markPlannedAdd(PATH, p(0), message("new"), 0);
        expect(ids()).toEqual(["pending:0:body"]);
        const added = previewLinesForFile(PATH)[0];
        expect(added.plannedOp).toBe("add");
    });

    test("subsequent adds resolve siblings even when both are still prefixed", () => {
        // The findIndexByIdAny path: when adding index 1, the model should
        // find the prefixed sibling at index 0 and insert AFTER it (not
        // fall through to the parent-body fallback and reverse the order).
        primeWithCache(PATH, func([]));
        markPlannedAdd(PATH, p(0), message("a"), 0);
        markPlannedAdd(PATH, p(1), message("b"), 1);
        markPlannedAdd(PATH, p(2), message("c"), 2);
        expect(ids()).toEqual(["pending:0:body", "pending:1:body", "pending:2:body"]);
    });

    test("re-firing planAdd for the same path is a no-op", () => {
        primeWithCache(PATH, func([]));
        markPlannedAdd(PATH, p(0), message("new"), 0);
        markPlannedAdd(PATH, p(0), message("new"), 0);
        expect(ids()).toEqual(["pending:0:body"]);
    });

    test("adds a CONDITIONAL with child content as one contiguous prefixed block", () => {
        primeWithCache(PATH, func([]));
        markPlannedAdd(PATH, p(0), conditional({ ifActions: [message("child")] }), 0);
        expect(ids()).toEqual([
            "pending:0:body",
            "pending:0.ifActions.0:body",
            "pending:0:close",
        ]);
    });
});

describe("markPlannedEdit", () => {
    test("keeps one row for an in-place edit", () => {
        primeWithCache(PATH, func([message("old")]));
        markPlannedEdit(PATH, p(0), message("old"), message("new"));
        expect(ids()).toEqual(["0:body"]);
        expect(bodyAt(0)?.plannedOp).toBe("edit");
        expect(bodyAt(0)?.tokens.map((token) => token.text).join("")).toBe(
            'chat "old"'
        );
    });
});

describe("markPlannedDelete", () => {
    test("marks the body line as delete", () => {
        primeWithCache(PATH, func([message("x")]));
        markPlannedDelete(PATH, p(0));
        expect(bodyAt(0)?.plannedOp).toBe("delete");
    });

    test("marks every line of a CONDITIONAL subtree as delete", () => {
        primeWithCache(PATH, func([conditional({ ifActions: [message("child")] })]));
        markPlannedDelete(PATH, p(0));
        for (const line of previewLinesForFile(PATH)) {
            expect(line.plannedOp).toBe("delete");
        }
    });
});

describe("markPlannedMove", () => {
    test("retains move as a distinct operation", () => {
        primeWithCache(PATH, func([message("a"), message("b")]));
        markPlannedMove(PATH, p(1), 1, 0);
        expect(bodyAt(1)?.plannedOp).toBe("move");
        expect(bodyAt(0)?.plannedOp).toBeUndefined();
    });
});

describe("rebaseToDesired", () => {
    test("builds the index map from consumed observed actions and ordered matches", () => {
        const operations: PlannedOp[] = [
            {
                op: "delete",
                path: p(0),
                actionType: "MESSAGE",
                observed: message("removed"),
                observedEntryId: 0,
                fromIndex: 0,
            },
            {
                op: "move",
                path: p(0),
                actionType: "MESSAGE",
                fromIndex: 2,
                toIndex: 0,
            },
            {
                op: "edit",
                path: p(2),
                actionType: "MESSAGE",
                observed: message("old"),
                desired: message("new"),
                fromIndex: 3,
                toIndex: 2,
                fieldsChanged: ["message"],
            },
        ];

        const indexMap = buildObservedToDesiredIndexMap(
            [0, 1, 2, 3],
            undefined,
            operations,
            [p(1)]
        );

        expect(Array.from(indexMap?.entries() ?? []).sort((a, b) => a[0] - b[0])).toEqual(
            [
                [1, 1],
                [2, 0],
                [3, 2],
            ]
        );
        expect(
            buildObservedToDesiredIndexMap([0, 1, 2, 3], undefined, operations, [])
        ).toBeNull();
    });

    test("rebases a move once so its desired path can be highlighted", () => {
        setObservedTopLevel(PATH, nodes(message("a"), message("b")), {
            force: true,
        });
        const operations: PlannedOp[] = [
            {
                op: "move",
                path: p(0),
                actionType: "MESSAGE",
                fromIndex: 1,
                toIndex: 0,
            },
        ];

        rebaseToDesired(PATH, undefined, operations, [p(1)]);
        const rebasedRevision = previewRevision(PATH);
        rebaseToDesired(PATH, undefined, operations, [p(1)]);
        markPlannedMove(PATH, p(0), 1, 0);

        expect(ids()).toEqual(["1:body", "0:body"]);
        expect(previewRevision(PATH)).toBe(rebasedRevision + 1);
        expect(bodyAt(0)?.plannedOp).toBe("move");
    });

    test("keeps delete paths observed and removes only the flagged collision", () => {
        setObservedTopLevel(PATH, nodes(message("removed"), message("kept")), {
            force: true,
        });
        const operations: PlannedOp[] = [
            {
                op: "delete",
                path: p(0),
                actionType: "MESSAGE",
                observed: message("removed"),
                observedEntryId: 0,
                fromIndex: 0,
            },
        ];

        rebaseToDesired(PATH, undefined, operations, [p(0)]);
        markPlannedDelete(PATH, p(0));
        applyComplete(PATH, p(0), "delete", "delete");

        expect(ids()).toEqual(["0:body"]);
        expect(previewLinesForFile(PATH)[0].deleted).not.toBe(true);
    });

    test("rebases indices within a nested list without changing deeper components", () => {
        setObservedTopLevel(
            PATH,
            nodes(
                conditional({
                    ifActions: [message("a"), message("b")],
                })
            ),
            { force: true }
        );
        const listPath = ActionListPath.childOf(p(0), "ifActions");
        const operations: PlannedOp[] = [
            {
                op: "move",
                path: p(0, "ifActions", 0),
                actionType: "MESSAGE",
                fromIndex: 1,
                toIndex: 0,
            },
        ];

        rebaseToDesired(PATH, listPath, operations, [p(0, "ifActions", 1)]);
        markPlannedMove(PATH, p(0, "ifActions", 0), 1, 0);

        expect(ids()).toEqual([
            "0:body",
            "0.ifActions.1:body",
            "0.ifActions.0:body",
            "0:close",
        ]);
        expect(bodyAt(0, "ifActions", 0)?.plannedOp).toBe("move");
    });
});

describe("applyComplete(add)", () => {
    test("strips the pending: prefix and marks completed", () => {
        primeWithCache(PATH, func([]));
        markPlannedAdd(PATH, p(0), message("x"), 0);
        applyComplete(PATH, p(0), "add", "add");
        expect(ids()).toEqual(["0:body"]);
        expect(bodyAt(0)?.completed).toBe(true);
        expect(bodyAt(0)?.plannedOp).toBeUndefined();
    });

    test("bottom-up apply (child first, then outer) is idempotent on prefix strip", () => {
        // CONDITIONAL add inserts parent + child with pending: prefix.
        // Child applyComplete fires first; it should strip the child's
        // prefix without affecting the parent. Parent applyComplete then
        // strips its own prefix without touching the already-stripped child.
        primeWithCache(PATH, func([]));
        markPlannedAdd(PATH, p(0), conditional({ ifActions: [message("child")] }), 0);
        applyComplete(PATH, p(0, "ifActions", 0), "add", "add");
        applyComplete(PATH, p(0), "add", "add");
        expect(ids()).toEqual(["0:body", "0.ifActions.0:body", "0:close"]);
        for (const line of previewLinesForFile(PATH)) {
            expect(line.completed).toBe(true);
            expect(line.plannedOp).toBeUndefined();
        }
    });
});

describe("applyComplete(delete)", () => {
    test("removes the line and its subtree", () => {
        primeWithCache(PATH, func([conditional({ ifActions: [message("child")] })]));
        markPlannedDelete(PATH, p(0));
        applyComplete(PATH, p(0), "delete", "delete");
        expect(previewLinesForFile(PATH)).toEqual([]);
    });

    test("leaves siblings alone", () => {
        primeWithCache(PATH, func([message("a"), message("b"), message("c")]));
        markPlannedDelete(PATH, p(1));
        applyComplete(PATH, p(1), "delete", "delete");
        expect(ids()).toEqual(["0:body", "2:body"]);
    });
});

describe("applyComplete(edit)", () => {
    test("updates the existing row when the edit completes", () => {
        primeWithCache(PATH, func([message("old")]));
        markPlannedEdit(PATH, p(0), message("old"), message("new"));
        applyComplete(PATH, p(0), "edit", "edit");
        expect(ids()).toEqual(["0:body"]);
        const body = bodyAt(0)!;
        expect(body.completed).toBe(true);
        expect(body.variant).toBe("body");
        expect(body.tokens.map((token) => token.text).join("")).toBe('chat "new"');
    });

    test("marks an unplanned edit complete", () => {
        primeWithCache(PATH, func([message("x")]));
        applyComplete(PATH, p(0), "edit", "edit");
        expect(bodyAt(0)?.completed).toBe(true);
    });
});

describe("applyComplete(move)", () => {
    test("clears the planned operation and marks body completed", () => {
        primeWithCache(PATH, func([message("a"), message("b")]));
        markPlannedMove(PATH, p(1), 1, 0);
        applyComplete(PATH, p(1), "match", "move");
        expect(bodyAt(1)?.completed).toBe(true);
        expect(bodyAt(1)?.plannedOp).toBeUndefined();
    });
});

describe("markHeadApplied", () => {
    test("flips CONDITIONAL head + close to completed without finishing child", () => {
        primeWithCache(PATH, func([conditional({ ifActions: [message("child")] })]));
        markHeadApplied(PATH, p(0));
        expect(bodyAt(0)?.completed).toBe(true);
        const close = previewLinesForFile(PATH).find((l) => l.id === "0:close");
        expect(close?.completed).toBe(true);
        // Child body is NOT flipped by markHeadApplied — its own apply does that.
        expect(bodyAt(0, "ifActions", 0)?.completed).toBeFalsy();
    });

    test("handles a pending-add CONDITIONAL by stripping the prefix", () => {
        primeWithCache(PATH, func([]));
        markPlannedAdd(PATH, p(0), conditional({ ifActions: [message("child")] }), 0);
        markHeadApplied(PATH, p(0));
        const after = ids();
        expect(after).toContain("0:body");
        expect(after).toContain("0:close");
        // Child action keeps its prefix until its own applyComplete fires.
        expect(after).toContain("pending:0.ifActions.0:body");
    });

    test("applies the planned head tokens", () => {
        primeWithCache(PATH, func([conditional({})]));
        markPlannedEdit(PATH, p(0), conditional({}), conditional({ matchAny: true }));
        markHeadApplied(PATH, p(0));
        expect(bodyAt(0)?.completed).toBe(true);
    });
});

describe("finalizeFromSource", () => {
    test("rebuilds the line list from the source tree, all completed", () => {
        setObservedTopLevel(PATH, nodes(message("a")));
        markPlannedAdd(PATH, p(1), message("b"), 1);

        finalizeFromSource(PATH, [message("a"), message("b")]);

        expect(ids()).toEqual(["0:body", "1:body"]);
        for (const line of previewLinesForFile(PATH)) {
            expect(line.completed).toBe(true);
            expect(line.plannedOp).toBeUndefined();
        }
    });
});

describe("setCurrentOperation", () => {
    test("keeps a move cursor on the observed row when an add shares its path", () => {
        primeWithCache(PATH, func([message("existing")]));
        markPlannedAdd(PATH, p(0), message("added"), 0);

        setCurrentOperation(PATH, p(0), "move");
        expect(getCurrentOperation(PATH)).toEqual({ op: "move", lineId: "0:body" });

        setCurrentOperation(PATH, p(0), "add");
        expect(getCurrentOperation(PATH)).toEqual({
            op: "add",
            lineId: "pending:0:body",
        });
    });
});

describe("previewLineIdForPath", () => {
    test("returns the prefixed id when a pending-add exists at that path", () => {
        primeWithCache(PATH, func([]));
        markPlannedAdd(PATH, p(0), message("x"), 0);
        expect(previewLineIdForPath(PATH, p(0))).toBe("pending:0:body");
    });

    test("returns the unprefixed id when the path is observed", () => {
        primeWithCache(PATH, func([message("x")]));
        expect(previewLineIdForPath(PATH, p(0))).toBe("0:body");
    });

    test("falls forward to a rendered neighbor after the focused row is deleted", () => {
        primeWithCache(PATH, func([message("a"), message("b"), message("c")]));
        markPlannedDelete(PATH, p(1));
        applyComplete(PATH, p(1), "delete", "delete");

        expect(previewLineIdForPath(PATH, p(1))).toBe("2:body");
    });

    test("returns the unprefixed id when the path is unknown", () => {
        // Falls back to the canonical id so callers don't get null
        // when the model hasn't been built yet.
        expect(previewLineIdForPath(PATH, p(0))).toBe("0:body");
    });
});

describe("previewRevision", () => {
    test("changes on every line mutation and on reset", () => {
        expect(previewRevision(PATH)).toBe(-1);
        primeWithCache(PATH, func([message("hi")]));
        const primed = previewRevision(PATH);
        expect(primed).toBeGreaterThan(-1);

        markPlannedAdd(PATH, p(1), message("new"), 1);
        const planned = previewRevision(PATH);
        expect(planned).toBeGreaterThan(primed);

        applyComplete(PATH, p(1), "add", "add");
        expect(previewRevision(PATH)).toBeGreaterThan(planned);

        resetPreview(PATH);
        expect(previewRevision(PATH)).toBe(-1);
    });

    test("stays put when nothing mutates", () => {
        primeWithCache(PATH, func([message("hi")]));
        const before = previewRevision(PATH);
        previewLinesForFile(PATH);
        previewLineIdForPath(PATH, p(0));
        expect(previewRevision(PATH)).toBe(before);
    });
});
