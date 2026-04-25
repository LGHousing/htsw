import {
    FileLoader,
    parseActionsResult,
    SourceMap,
    Span,
    SpanTable,
    types,
} from "htsw";

type InlayHint = {
    label: string;
    span: Span;
};

function hint(label: string, span: Span): InlayHint {
    return { label, span };
}

export class StringFileLoader implements FileLoader {
    src: string;

    constructor(src: string) {
        this.src = src;
    }

    fileExists(_path: string): boolean {
        return true;
    }
    readFile(_path: string): string {
        return this.src;
    }
    getParentPath(_base: string): string {
        return "";
    }
    resolvePath(_base: string, _other: string): string {
        return "";
    }
}

export function provideInlayHints(src: string): InlayHint[] {
    const fileLoader = new StringFileLoader(src);
    const sourceMap = new SourceMap(fileLoader);
    const result = parseActionsResult(sourceMap, "file.htsl");

    return provideInlayHintsForActions(result.value, result.spans);
}

// Fields we never want to label, regardless of action type:
// - `type` is internal classification (e.g. "GIVE_ITEM"), not user-typed.
// - `note` is rendered as a /* doc comment */ above the action and isn't an
//   inline arg.
// - `holder` for CHANGE_VAR is set with the same span as the action keyword
//   (`var` / `globalvar` / etc.), so labeling it would just decorate the
//   action keyword itself with `holder:` — confusing rather than helpful.
const SKIP_INLAY_FIELDS = new Set(["type", "note"]);

function provideInlayHintsForActions(actions: types.Action[], spans: SpanTable): InlayHint[] {
    const hints: InlayHint[] = [];

    for (const action of actions) {
        if (action.type === "CONDITIONAL") {
            hints.push(...provideInlayHintsForConditions(action.conditions ?? [], spans));
            hints.push(...provideInlayHintsForActions(action.ifActions ?? [], spans));
            hints.push(...provideInlayHintsForActions(action.elseActions ?? [], spans));
            // `if` already reads cleanly with `and (...)` / `or (...)` and
            // braces — labeling `matchAny:`/`conditions:`/`ifActions:` would
            // just add noise on every conditional.
            continue;
        }
        if (action.type === "RANDOM") {
            hints.push(...provideInlayHintsForActions(action.actions ?? [], spans));
            continue;
        }

        for (const key of Object.keys(action)) {
            if (SKIP_INLAY_FIELDS.has(key)) continue;
            // CHANGE_VAR's `holder` shares the action-keyword span; skip it
            // so we don't decorate `var`/`globalvar`/`teamvar` with `holder:`.
            if (action.type === "CHANGE_VAR" && key === "holder") continue;
            // FUNCTION action's `function` field collides with the keyword
            // `function`, so labeling it produces `function function:"Foo"`.
            if (action.type === "FUNCTION" && key === "function") continue;

            const value = (action as any)[key];
            if (value === null || value === undefined) continue;

            const span = getOptionalFieldSpan(spans, action as object, key);
            if (!span) continue;

            hints.push(hint(key, span));
        }
    }

    return hints;
}

// Same skip rules as actions, plus condition-specific ones.
const SKIP_INLAY_CONDITION_FIELDS = new Set(["type", "inverted", "note"]);

function provideInlayHintsForConditions(
    conditions: types.Condition[],
    spans: SpanTable,
): InlayHint[] {
    const hints: InlayHint[] = [];

    for (const condition of conditions) {
        for (const key of Object.keys(condition)) {
            if (SKIP_INLAY_CONDITION_FIELDS.has(key)) continue;
            // COMPARE_VAR's `holder` shares the condition-keyword span (the
            // `var` / `globalvar` / `teamvar` keyword), so labeling it would
            // just decorate that keyword with `holder:`.
            if (condition.type === "COMPARE_VAR" && key === "holder") continue;

            const value = (condition as any)[key];
            if (value === null || value === undefined) continue;

            const span = getOptionalFieldSpan(spans, condition as object, key);
            if (!span) continue;

            hints.push(hint(key, span));
        }
    }

    return hints;
}

function getOptionalFieldSpan(
    spans: SpanTable,
    node: object,
    key: string,
): Span | undefined {
    try {
        return spans.getField(node, key as never);
    } catch {
        return undefined;
    }
}
