import { Diagnostic } from "../../diagnostic";
import type { Ir, IrAction, IrCondition } from "../../ir";
import type { ActionChangeVar, VarOperation } from "../../types";
import { TyCtxt } from "./context";
import { parseValue } from "./values";
import { applyNumericOperation, type VarKey } from "./state";

export function check(tcx: TyCtxt, actions: IrAction[]) {
    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];

        if (action.type === "CHANGE_VAR") {
            update(tcx, action);
        }

        else if (action.type === "CONDITIONAL") {
            if (!action.conditions || !action.matchAny) continue;

            if (action.ifActions) {
                for (const subCtxt of narrow(tcx, action.conditions.value, action.matchAny.value)) {
                    // tcx.exploredConditionalBranches.add(action.ifActions.value);
                    check(subCtxt, action.ifActions.value);
                    check(subCtxt, actions.slice(i + 1));
                }
            }

            if (action.elseActions) {
                for (const subCtxt of narrow(tcx, action.conditions.value, action.matchAny.value, true)) {
                    // tcx.exploredConditionalBranches.add(action.elseActions.value);
                    check(subCtxt, action.elseActions.value);
                    check(subCtxt, actions.slice(i + 1));
                }
            }
        }

        else if (action.type === "RANDOM") {
            if (!action.actions) continue;

            for (const subAction of action.actions.value) {
                check(tcx, [subAction, ...actions.slice(i + 1)]);
            }
        }

        else if (action.type === "PAUSE") {
            // well, now we can't say anything about the state!
            tcx.clearState();
        }
    }
}

const OPERATION_NAMES: {
    [op in VarOperation]: string
} = {
    Set: "assigned",
    Increment: "incremented",
    Decrement: "decremented",
    Multiply: "multiplied",
    Divide: "divided",
    "Shift Left": "shifted left",
    "Shift Right": "shifted right",
    "And Assign": "used with logical and",
    "Or Assign": "used with logical or",
    "Xor Assign": "used with logical xor",
    Unset: "unset",
}

const DISALLOWED_DOUBLE_OPERATIONS: VarOperation[] = [
    "Shift Left", "Shift Right", "And Assign", "Or Assign", "Xor Assign"
];

function update(tcx: TyCtxt, action: Ir<ActionChangeVar>) {
    if (!action.holder || !action.key || !action.op || !action.value) return;

    const key = { holder: action.holder.value, key: action.key.value } as VarKey;
    const lhs = tcx.getState(key);
    const rhs = parseValue(tcx, action.value.value);

    if (!rhs) return;

    if (action.op.value === "Set") {
        tcx.setState(key, { ...rhs, declSpan: action.span });
        return;
    }

    if (action.op.value === "Unset") {
        tcx.removeState(key);
        return;
    }

    if (lhs && lhs.type === "string") {
        tcx.addDiagnostic(
            Diagnostic.warning(`Strings cannot be ${OPERATION_NAMES[action.op.value]}`)
                .addPrimarySpan(action.op.span, "Invalid operation")
                .addSecondarySpan(action.key.span, `Type inferred as ${lhs.type}`)
                .addSecondarySpan(lhs.declSpan, "Type originates from this statement")
        );
        return;
    }

    if (lhs && lhs.type === "double" && action.op.value in DISALLOWED_DOUBLE_OPERATIONS) {
        tcx.addDiagnostic(
            Diagnostic.warning(`Doubles cannot be ${OPERATION_NAMES[action.op.value]}`)
                .addPrimarySpan(action.op.span, "Invalid operation")
                .addSecondarySpan(action.key.span, `Type inferred as ${lhs.type}`)
                .addSecondarySpan(lhs.declSpan, "Type originates from this statement")
        );
        return;
    }

    if (!lhs) {
        tcx.setState(key, { type: rhs.type, isKnown: false, declSpan: action.span });
        return;
    }

    if (lhs.type !== rhs.type) {
        tcx.addDiagnostic(
            Diagnostic.warning("Mismatched types")
                .addPrimarySpan(action.value.span, `Expected ${lhs.type}, found ${rhs.type}`)
                .addSecondarySpan(action.key.span, `Type is ${lhs.type}`)
                .addSecondarySpan(lhs.declSpan, "Type inferred here")
        );
        return;
    }

    if (!lhs.isKnown || !rhs.isKnown) {
        // Aside from checking to make sure the types are compatible, there is
        // nothing we can do in this case. In the case that the rhs is unknown,
        // this state then becomes unknown.
        tcx.setState(key, { ...lhs, isKnown: false });
        return;
    }

    const newValue = applyNumericOperation(lhs, rhs, action.op.value);
    tcx.setState(key, { ...lhs, ...newValue });
}

function maybeInvert(value: boolean, inverted: boolean) {
    return inverted ? !value : value;
}

function narrow(
    tcx: TyCtxt,
    conditions: IrCondition[],
    matchAny: boolean,
    inverted: boolean = false
): TyCtxt[] {
    if (conditions.length === 0) return [tcx]; // Just use the owning ctxt

    if (maybeInvert(matchAny, inverted)) {
        const res: TyCtxt[] = [];
        for (const condition of conditions) {
            res.push(...narrow(tcx, [condition], inverted, inverted));
        }
        return res;
    }

    
    
    throw Error("Not implemented");
}

function narrowCondition(
    tcx: TyCtxt,
    condition: IrCondition,
) {
    // if (condition.)
}