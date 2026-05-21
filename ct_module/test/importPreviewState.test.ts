import { beforeEach, describe, expect, test } from "vitest";
import type { Action, Importable } from "htsw/types";

import {
    applyComplete,
    finalizeFromSource,
    markHeadApplied,
    markPlannedAdd,
    markPlannedDelete,
    markPlannedEdit,
    markPlannedMove,
    previewLineIdForPath,
    previewLinesForFile,
    primeWithCache,
    resetPreview,
    setObservedTopLevel,
    type PreviewLine,
} from "../src/gui/state/importPreviewState";

import { conditional, message, playSound } from "./utils";

const PATH = "./test.htsl";

function ids(): string[] {
    return previewLinesForFile(PATH).map((l) => l.id);
}

function bodyAt(actionPath: string): PreviewLine | undefined {
    return previewLinesForFile(PATH).find((l) => l.id === `${actionPath}:body`);
}

function func(actions: Action[]): Importable {
    return { type: "FUNCTION", name: "test", actions };
}

function pendingAddedIds(): string[] {
    return previewLinesForFile(PATH)
        .map((l) => l.id)
        .filter((id) => id.indexOf("__add::") === 0);
}

beforeEach(() => {
    resetPreview(PATH);
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

    test("CONDITIONAL renders head + close with stable ids", () => {
        primeWithCache(PATH, func([
            conditional({ ifActions: [message("inner")], elseActions: [] }),
        ]));
        expect(ids()).toEqual(["0:body", "0.ifActions.0:body", "0:close"]);
    });

    test("CONDITIONAL with else renders body, :else, close", () => {
        primeWithCache(PATH, func([
            conditional({
                ifActions: [message("a")],
                elseActions: [message("b")],
            }),
        ]));
        expect(ids()).toEqual([
            "0:body",
            "0.ifActions.0:body",
            "0:else",
            "0.elseActions.0:body",
            "0:close",
        ]);
    });

    test("nested CONDITIONAL preserves dotted paths", () => {
        primeWithCache(PATH, func([
            conditional({
                ifActions: [conditional({ ifActions: [message("deep")] })],
            }),
        ]));
        expect(ids()).toContain("0.ifActions.0.ifActions.0:body");
    });
});

describe("setObservedTopLevel", () => {
    test("replaces line list with observed actions", () => {
        primeWithCache(PATH, func([message("old")]));
        setObservedTopLevel(PATH, [message("a"), message("b")]);
        expect(ids()).toEqual(["0:body", "1:body"]);
    });

    test("null nested entries render as a collapsed placeholder", () => {
        const cond = conditional({
            // Three slots, none hydrated yet.
            ifActions: [null, null, null] as unknown as Action[],
        });
        setObservedTopLevel(PATH, [cond]);
        const line = previewLinesForFile(PATH).find((l) =>
            l.id === "0.ifActions:placeholder"
        );
        expect(line).toBeDefined();
        expect(line!.isPlaceholder).toBe(true);
        // The text reports the count so the user sees how big the unhydrated body is.
        expect(line!.tokens.map((t) => t.text).join("")).toContain("3 actions");
    });
});

describe("markPlannedAdd", () => {
    test("inserts a pending-add line with the __add:: prefix", () => {
        primeWithCache(PATH, func([]));
        markPlannedAdd(PATH, "0", message("new"), 0);
        expect(ids()).toEqual(["__add::0:body"]);
        const added = previewLinesForFile(PATH)[0];
        expect(added.diffState).toBe("add");
    });

    test("subsequent adds resolve siblings even when both are still prefixed", () => {
        // The findIndexByIdAny path: when adding index 1, the model should
        // find the prefixed sibling at index 0 and insert AFTER it (not
        // fall through to the parent-body fallback and reverse the order).
        primeWithCache(PATH, func([]));
        markPlannedAdd(PATH, "0", message("a"), 0);
        markPlannedAdd(PATH, "1", message("b"), 1);
        markPlannedAdd(PATH, "2", message("c"), 2);
        expect(ids()).toEqual([
            "__add::0:body",
            "__add::1:body",
            "__add::2:body",
        ]);
    });

    test("re-firing planAdd for the same path is a no-op", () => {
        primeWithCache(PATH, func([]));
        markPlannedAdd(PATH, "0", message("new"), 0);
        markPlannedAdd(PATH, "0", message("new"), 0);
        expect(ids()).toEqual(["__add::0:body"]);
    });

    test("adds a CONDITIONAL with inner content as one contiguous prefixed block", () => {
        primeWithCache(PATH, func([]));
        markPlannedAdd(
            PATH,
            "0",
            conditional({ ifActions: [message("inner")] }),
            0
        );
        expect(ids()).toEqual([
            "__add::0:body",
            "__add::0.ifActions.0:body",
            "__add::0:close",
        ]);
    });
});

describe("markPlannedEdit", () => {
    test("inserts a gold ghost line below the body", () => {
        primeWithCache(PATH, func([message("old")]));
        markPlannedEdit(PATH, "0", message("old"), message("new"));
        expect(ids()).toEqual(["0:body", "0:ghost"]);
        const ghost = previewLinesForFile(PATH)[1];
        expect(ghost.isGhost).toBe(true);
        expect(ghost.italic).toBe(true);
        expect(ghost.diffState).toBe("edit");
        // Ghost takes no line number — it isn't part of the file's numbering.
        expect(ghost.lineNum).toBe(0);
    });

    test("body line is marked as edit", () => {
        primeWithCache(PATH, func([message("old")]));
        markPlannedEdit(PATH, "0", message("old"), message("new"));
        expect(bodyAt("0")?.diffState).toBe("edit");
    });
});

describe("markPlannedDelete", () => {
    test("marks the body line as delete", () => {
        primeWithCache(PATH, func([message("x")]));
        markPlannedDelete(PATH, "0");
        expect(bodyAt("0")?.diffState).toBe("delete");
    });

    test("marks every line of a CONDITIONAL subtree as delete", () => {
        primeWithCache(PATH, func([
            conditional({ ifActions: [message("inner")] }),
        ]));
        markPlannedDelete(PATH, "0");
        for (const line of previewLinesForFile(PATH)) {
            expect(line.diffState).toBe("delete");
        }
    });
});

describe("markPlannedMove", () => {
    test("marks the moved body as edit (gold)", () => {
        primeWithCache(PATH, func([message("a"), message("b")]));
        markPlannedMove(PATH, "1", 1, 0);
        expect(bodyAt("1")?.diffState).toBe("edit");
        // The non-moved sibling stays untouched.
        expect(bodyAt("0")?.diffState).toBeUndefined();
    });
});

describe("applyComplete(add)", () => {
    test("strips the __add:: prefix and marks completed", () => {
        primeWithCache(PATH, func([]));
        markPlannedAdd(PATH, "0", message("x"), 0);
        applyComplete(PATH, "0", "add", "add");
        expect(ids()).toEqual(["0:body"]);
        expect(bodyAt("0")?.completed).toBe(true);
        expect(bodyAt("0")?.diffState).toBeUndefined();
    });

    test("bottom-up apply (nested first, then outer) is idempotent on prefix strip", () => {
        // CONDITIONAL add inserts outer + inner with __add:: prefix.
        // Inner applyComplete fires first; it should strip the inner's
        // prefix without affecting the outer. Outer applyComplete then
        // strips its own prefix without touching the already-stripped inner.
        primeWithCache(PATH, func([]));
        markPlannedAdd(
            PATH,
            "0",
            conditional({ ifActions: [message("inner")] }),
            0
        );
        applyComplete(PATH, "0.ifActions.0", "add", "add");
        applyComplete(PATH, "0", "add", "add");
        expect(ids()).toEqual(["0:body", "0.ifActions.0:body", "0:close"]);
        for (const line of previewLinesForFile(PATH)) {
            expect(line.completed).toBe(true);
            expect(line.diffState).toBeUndefined();
        }
    });
});

describe("applyComplete(delete)", () => {
    test("removes the line and its subtree", () => {
        primeWithCache(PATH, func([
            conditional({ ifActions: [message("inner")] }),
        ]));
        applyComplete(PATH, "0", "delete", "delete");
        expect(previewLinesForFile(PATH)).toEqual([]);
    });

    test("leaves siblings alone", () => {
        primeWithCache(PATH, func([message("a"), message("b"), message("c")]));
        applyComplete(PATH, "1", "delete", "delete");
        expect(ids()).toEqual(["0:body", "2:body"]);
    });
});

describe("applyComplete(edit)", () => {
    test("promotes the ghost to the body and removes the original", () => {
        primeWithCache(PATH, func([message("old")]));
        markPlannedEdit(PATH, "0", message("old"), message("new"));
        applyComplete(PATH, "0", "edit", "edit");
        // After: only one line, at the same id, marked completed.
        expect(ids()).toEqual(["0:body"]);
        const body = bodyAt("0")!;
        expect(body.completed).toBe(true);
        expect(body.isGhost).toBeFalsy();
        expect(body.italic).toBeFalsy();
    });

    test("no ghost present: just marks body completed", () => {
        primeWithCache(PATH, func([message("x")]));
        applyComplete(PATH, "0", "edit", "edit");
        expect(bodyAt("0")?.completed).toBe(true);
    });
});

describe("applyComplete(move)", () => {
    test("clears the diff state and marks body completed", () => {
        primeWithCache(PATH, func([message("a"), message("b")]));
        markPlannedMove(PATH, "1", 1, 0);
        applyComplete(PATH, "1", "match", "move");
        expect(bodyAt("1")?.completed).toBe(true);
        expect(bodyAt("1")?.diffState).toBeUndefined();
    });
});

describe("markHeadApplied", () => {
    test("flips CONDITIONAL head + close to completed without finishing inner", () => {
        primeWithCache(PATH, func([
            conditional({ ifActions: [message("inner")] }),
        ]));
        markHeadApplied(PATH, "0");
        expect(bodyAt("0")?.completed).toBe(true);
        const close = previewLinesForFile(PATH).find((l) => l.id === "0:close");
        expect(close?.completed).toBe(true);
        // Inner body is NOT flipped by markHeadApplied — its own apply does that.
        expect(bodyAt("0.ifActions.0")?.completed).toBeFalsy();
    });

    test("handles a pending-add CONDITIONAL by stripping the prefix", () => {
        primeWithCache(PATH, func([]));
        markPlannedAdd(
            PATH,
            "0",
            conditional({ ifActions: [message("inner")] }),
            0
        );
        markHeadApplied(PATH, "0");
        const after = ids();
        expect(after).toContain("0:body");
        expect(after).toContain("0:close");
        // Inner child keeps its prefix until its own applyComplete fires.
        expect(after).toContain("__add::0.ifActions.0:body");
    });

    test("promotes a ghost when planEdit happened before markHeadApplied", () => {
        primeWithCache(PATH, func([conditional({})]));
        markPlannedEdit(
            PATH,
            "0",
            conditional({}),
            conditional({ matchAny: true })
        );
        markHeadApplied(PATH, "0");
        // Ghost is gone; body carries forward.
        expect(ids().filter((id) => id.indexOf("ghost") >= 0)).toEqual([]);
        expect(bodyAt("0")?.completed).toBe(true);
    });
});

describe("finalizeFromSource", () => {
    test("rebuilds the line list from the source tree, all completed", () => {
        // Start in a messy intermediate state — some pending-add lines,
        // some diff states still set.
        setObservedTopLevel(PATH, [message("a")]);
        markPlannedAdd(PATH, "1", message("b"), 1);

        finalizeFromSource(PATH, [message("a"), message("b")]);

        expect(ids()).toEqual(["0:body", "1:body"]);
        for (const line of previewLinesForFile(PATH)) {
            expect(line.completed).toBe(true);
            expect(line.diffState).toBeUndefined();
        }
    });
});

describe("previewLineIdForPath", () => {
    test("returns the prefixed id when a pending-add exists at that path", () => {
        primeWithCache(PATH, func([]));
        markPlannedAdd(PATH, "0", message("x"), 0);
        expect(previewLineIdForPath(PATH, "0")).toBe("__add::0:body");
    });

    test("returns the unprefixed id when the path is observed", () => {
        primeWithCache(PATH, func([message("x")]));
        expect(previewLineIdForPath(PATH, "0")).toBe("0:body");
    });

    test("returns the unprefixed id when the path is unknown", () => {
        // Falls back to the canonical id so callers don't get null
        // when the model hasn't been built yet.
        expect(previewLineIdForPath(PATH, "0")).toBe("0:body");
    });
});

describe("move+add at same path — the dedup band-aid", () => {
    // Documents the current behavior: when the diff plans both a MOVE for
    // observed[1] and an ADD for desired[1] at the same source path, the
    // GUI ends up with a duplicate :body line after the add's prefix is
    // stripped. The current implementation dedups positionally, keeping
    // the latest insertion. This test pins the observable behavior so a
    // future importer-side fix can be verified to change the trace before
    // landing.
    test("dedups one of the two body lines after stripping the prefix", () => {
        // Observed sequence: [a, b]. b is at index 1.
        setObservedTopLevel(PATH, [message("a"), message("b")]);

        // Diff plans: move b from 1 → 0, AND add c at 1 (the slot b vacated).
        // Both ops carry source-path "1".
        markPlannedMove(PATH, "1", 1, 0);
        markPlannedAdd(PATH, "1", message("c"), 1);

        // Just before the band-aid: two lines share actionPath "1" — the
        // existing observed body and the pending-add prefixed body.
        const idsBefore = ids();
        expect(idsBefore.filter((id) => id === "1:body")).toHaveLength(1);
        expect(idsBefore.filter((id) => id === "__add::1:body")).toHaveLength(1);

        // applyComplete(add) strips the prefix → both have id "1:body" →
        // dedup keeps the later one (the just-promoted add).
        applyComplete(PATH, "1", "add", "add");

        const after = ids();
        // Only one "1:body" survives. If the importer fix lands, this should
        // still hold — but the trace upstream should show NOT having issued
        // both a move and an add for the same path in the first place.
        expect(after.filter((id) => id === "1:body")).toHaveLength(1);
    });
});
