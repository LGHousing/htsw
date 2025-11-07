import type { VarName } from "htsl";
import type { ParseResult, Ir } from "../../ir";
import { Span } from "../../span";
import type { ActionChangeVar, Operation, Value, VarHolder } from "../../types";
import { check } from ".";

function changeVarIrAction(
    holder: VarHolder,
    key: VarName,
    op: Operation | "unset",
    value: Value
): Ir<ActionChangeVar> {
    return {
        type: "CHANGE_VAR",
        holder: {
            value: holder,
            span: new Span(0, 0),
        },
        key: {
            value: key,
            span: new Span(0, 0),
        },
        op: {
            value: op,
            span: new Span(0, 0),
        },
        value: {
            value: value,
            span: new Span(0, 0),
        },
        span: new Span(0, 0),
        kwSpan: new Span(0, 0),
    };
}

const result: ParseResult = {
    actions: [
        changeVarIrAction({ type: "player" }, "x", "set", "42"),
        changeVarIrAction({ type: "player" }, "y", "set", '"%var.player/x%"'),
        changeVarIrAction({ type: "player" }, "y", "increment", '1'),
        changeVarIrAction({ type: "player" }, "z", "set", '"%var.player/y 69%"'),
    ],
    diagnostics: [],
};
const states = check(result);
for (const diag of result.diagnostics) {
    console.log(`[${diag.level}] ${diag.message}`);
}
for (const [key, typeStates] of states) {
    console.log();
    const keyData = JSON.parse(key);
    console.log(`${keyData.holder.type} var "${keyData.key}"`);
    for (const ts of typeStates) {
        console.log(`  ${ts.type} (${ts.certainty}): ${JSON.stringify(ts.value)}`);
    }
}
