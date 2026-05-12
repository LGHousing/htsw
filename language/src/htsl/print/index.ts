/**
 * HTSL printer — converts a parsed `Action[]` (or single `Action`/`Condition`)
 * back into idiomatic HTSL source. The printer is the inverse of
 * `parseHtsl`/`parseAction`/`parseCondition` and aims for round-trip
 * equality at the AST level: `parse(print(parse(src)))` deep-equals
 * `parse(src)` for every supported construct.
 *
 * Item-bearing actions (GIVE_ITEM, REMOVE_ITEM, DROP_ITEM) cannot fully
 * round-trip because HTSL has no syntax for inline item NBT; they emit a
 * placeholder name and add a warning to the diagnostic list returned by
 * `printActionsWithDiagnostics`.
 */

import type { Action, Condition } from "../../types";
import {
    printActionHeadSpans,
    printActionList,
    type FieldSpan,
    type PrintActionsContext,
    type PrinterDiagnostic,
} from "./actions";
import { printCondition as printConditionImpl } from "./conditions";
import { DEFAULT_PRINT_STYLE, resolveStyle, type PrintStyle } from "./style";

export { DEFAULT_PRINT_STYLE };
export type { PrintStyle, PrinterDiagnostic, FieldSpan };

/** Print a list of actions to HTSL source. */
export function printActions(
    actions: readonly Action[],
    style?: Partial<PrintStyle>,
): string {
    return printActionsWithDiagnostics(actions, style).source;
}

/**
 * Print a list of actions and also return any printer diagnostics produced
 * along the way (e.g. warnings about item-NBT placeholders).
 */
export function printActionsWithDiagnostics(
    actions: readonly Action[],
    style?: Partial<PrintStyle>,
): { source: string; diagnostics: PrinterDiagnostic[] } {
    const resolved = resolveStyle(style);
    const ctx: PrintActionsContext = { style: resolved, diagnostics: [] };
    let source = printActionList(actions, 0, ctx);
    if (!resolved.trailingNewline && source.endsWith(resolved.lineEnding)) {
        source = source.slice(0, source.length - resolved.lineEnding.length);
    }
    return { source, diagnostics: ctx.diagnostics };
}

/** Print a single action as a single line (or block, for nested actions). */
export function printAction(
    action: Action,
    style?: Partial<PrintStyle>,
): string {
    return printActions([action], style);
}

/** Print a single condition body (without the surrounding `if (...)`). */
export function printCondition(cond: Condition): string {
    return printConditionImpl(cond);
}

/**
 * Print a single action's head text plus per-field character spans.
 * Coverage is opportunistic — actions without bespoke span instrumentation
 * return `fieldSpans: []` and the consumer falls back gracefully (no
 * underlines / field box). For block-bearing actions, only the head
 * (`if and (...)`, `random `) text is covered.
 */
export function printActionSpans(
    action: Action,
    style?: Partial<PrintStyle>,
): { text: string; fieldSpans: FieldSpan[] } {
    const resolved = resolveStyle(style);
    const ctx: PrintActionsContext = { style: resolved, diagnostics: [] };
    return printActionHeadSpans(action, 0, ctx);
}
