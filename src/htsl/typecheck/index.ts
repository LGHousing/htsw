import type { ParseContext } from "../../context";
import { Diagnostic } from "../../diagnostic";
import type { Ir } from "../../ir";
import { tryIntoPlaceholder, type PlaceholderChangeVar } from "../../placeholder";
import type { ActionChangeVar } from "../../types";
import { knownConstant, unknown, type TypeState } from "./state";

// refactor this idk
export type TypeStateKey = string;
function actionIntoTypeStateKey(action: Ir<ActionChangeVar>): TypeStateKey {
    return JSON.stringify({
        holder: action.holder?.value || null,
        key: action.key?.value || null,
    });
}
function placeholderIntoTypeStateKey(placeholder: PlaceholderChangeVar): TypeStateKey {
    return JSON.stringify({
        holder: placeholder.holder,
        key: placeholder.key,
    });
}

export type StatesMap = Map<TypeStateKey, TypeState[]>;

function insertTypeState(states: StatesMap, key: TypeStateKey, state: TypeState) {
    // TODO shit ton of logic to merge states + add diagnostics if they cant merge
    if (!states.has(key)) {
        states.set(key, []);
    }
    states.get(key)!.push(state);
}

const LONG_REGEX = /^-?\d+$/;
const DOUBLE_REGEX = /^-?\d+\.\d+$/;

function handleChangeVar(
    ctx: ParseContext,
    action: Ir<ActionChangeVar>,
    states: StatesMap
) {
    const key = actionIntoTypeStateKey(action);
    const op = action.op?.value;
    if (op === "unset") {
        // unset; type is gone
        states.delete(key);
        return;
    }

    const value = action.value?.value;
    if (value === undefined) {
        ctx.addDiagnostic(
            Diagnostic.error("This should not be reachable").label(action.span)
        );
        return;
    }

    const normalizedValue =
        value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
    const isSetOperation = op === "Set";
    const certainty = isSetOperation ? "certainly" : "probably";

    if (LONG_REGEX.test(normalizedValue)) {
        // long constant
        // TODO support arithmetic
        insertTypeState(states, key, {
            ...(isSetOperation
                ? knownConstant("long", parseInt(normalizedValue, 10))
                : unknown("long")),
            certainty,
        });
        return;
    }
    if (DOUBLE_REGEX.test(normalizedValue)) {
        // double constant
        // TODO support arithmetic
        insertTypeState(states, key, {
            ...(isSetOperation
                ? knownConstant("double", parseFloat(normalizedValue))
                : unknown("double")),
            certainty,
        });
        return;
    }

    const placeholder = tryIntoPlaceholder(normalizedValue);
    if (!placeholder) {
        // no numeric constant, not a placeholder -> string constant
        // strings can only use "set"
        // TODO fill in known constant placeholders here
        insertTypeState(states, key, {
            ...knownConstant("string", value),
            certainty,
        });
        return;
    }

    switch (placeholder.type) {
        case "BUILTIN": {
            insertTypeState(states, key, {
                ...placeholder.returnType,
                certainty,
            });
            break;
        }
        case "CHANGE_VAR": {
            const placeholderKey = placeholderIntoTypeStateKey(placeholder);
            for (const ts of states.get(placeholderKey) || []) {
                switch (ts.certainty) {
                    case "certainly":
                        insertTypeState(states, key, {
                            ...ts,
                            certainty,
                        });
                        break;
                    default:
                        insertTypeState(states, key, {
                            ...ts,
                            certainty: "probably",
                        });
                        break;
                }
            }
            break;
        }
    }
}

export function check(pr: ParseResult): StatesMap {
    const states: StatesMap = new Map();

    for (const action of pr.actions) {
        switch (action.type) {
            case "CHANGE_VAR": {
                handleChangeVar(pr, action, states);
                break;
            }
            default: {
                break;
            }
        }
    }

    return states;
}
