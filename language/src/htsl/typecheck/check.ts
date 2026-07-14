import { Diagnostic } from "../../diagnostic";
import type { Action, ActionChangeVar, VarOperation } from "../../types";
import { TyCtxt } from "./context";
import { parseValue } from "./values";
import { applyNumericOperation, type VarKey } from "./state";

export function check(tcx: TyCtxt, actions: Action[]) {
    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];

        if (action.type === "CHANGE_VAR") {
            update(tcx, action);
        }

        else if (action.type === "CONDITIONAL") {
            if (action.conditions.length === 0) {
                check(tcx, action.ifActions);
                continue;
            }
            const branches = [tcx.clone(), tcx.clone()];
            check(branches[0], action.ifActions);
            check(branches[1], action.elseActions);
            tcx.keepStatesUnchangedIn(branches);
        }

        else if (action.type === "RANDOM") {
            if (action.actions.length === 0) continue;

            const branches = action.actions.map(() => tcx.clone());
            for (let branchIndex = 0; branchIndex < action.actions.length; branchIndex++) {
                check(branches[branchIndex], [action.actions[branchIndex]]);
            }
            tcx.keepStatesUnchangedIn(branches);
        }

        else if (action.type === "PAUSE") {
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
    "Left Shift": "shifted left",
    "Arithmetic Right Shift": "shifted right",
    "Logical Right Shift": "shifted right",
    "Bitwise AND": "used with logical AND",
    "Bitwise OR": "used with logical OR",
    "Bitwise XOR": "used with logical XOR",
    Unset: "unset",
}

const DISALLOWED_DOUBLE_OPERATIONS: VarOperation[] = [
    "Left Shift", "Arithmetic Right Shift", "Logical Right Shift", "Bitwise AND", "Bitwise OR", "Bitwise XOR"
];

function update(tcx: TyCtxt, action: ActionChangeVar) {
    if (!action.holder || !action.key || !action.op) return;

    const key = { holder: action.holder, key: action.key } as VarKey;

    // Check for unset before we actually require the RHS value
    if (action.op === "Unset") {
        tcx.removeState(key);
        return;
    }

    if (!action.value) return;
    
    const lhs = tcx.getState(key);
    const rhs = parseValue(tcx, action.value);

    const span = tcx.gcx.spans.get(action);
    const opSpan = tcx.gcx.spans.getField(action, "op");
    const keySpan = tcx.gcx.spans.getField(action, "key");
    const valueSpan = tcx.gcx.spans.getField(action, "value");

    if (action.op === "Set") {
        if (!rhs) {
             // We don't know anything about this variable anymore.
            tcx.removeState(key);
            return;
        }
        
        tcx.setState(key, { ...rhs, declSpan: span });
        return;
    }

    if (!rhs) {
        // Because we don't know the type of the RHS, we just have
        // to trust that this operation is allowed.
        return;
    }
    
    if (lhs && lhs.type === "string") {
        tcx.addDiagnostic(
            Diagnostic.warning(`Strings cannot be ${OPERATION_NAMES[action.op]}`)
                .addPrimarySpan(opSpan, "Invalid operation")
                .addSecondarySpan(keySpan, `Type inferred as ${lhs.type}`)
                .addSecondarySpan(lhs.declSpan, "Type originates from this statement")
        );
        return;
    }

    if (lhs && lhs.type === "double" && DISALLOWED_DOUBLE_OPERATIONS.includes(action.op)) {
        tcx.addDiagnostic(
            Diagnostic.warning(`Doubles cannot be ${OPERATION_NAMES[action.op]}`)
                .addPrimarySpan(opSpan, "Invalid operation")
                .addSecondarySpan(keySpan, `Type inferred as ${lhs.type}`)
                .addSecondarySpan(lhs.declSpan, "Type originates from this statement")
        );
        return;
    }

    if (!lhs) {
        tcx.setState(key, { type: rhs.type, isKnown: false, declSpan: span });
        return;
    }

    if (lhs.type !== rhs.type) {
        tcx.addDiagnostic(
            Diagnostic.warning("Mismatched types")
                .addPrimarySpan(opSpan, "Mismatched types")
                .addSecondarySpan(keySpan, `Type is ${lhs.type}`)
                .addSecondarySpan(valueSpan, `Type is ${rhs.type}`)
                .addSecondarySpan(lhs.declSpan, `Type of ${action.key} inferred here`)
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

    const newValue = applyNumericOperation(lhs, rhs, action.op);
    tcx.setState(key, { ...lhs, ...newValue });
}
