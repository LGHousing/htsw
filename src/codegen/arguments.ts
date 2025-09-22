import type { Action, Condition, Operation, Value } from "../types";
import { generateAction } from "./actions";

export function generateString(string: string): string {
    return `"${string}"`;
}

export function generateOperation(op: Operation | "unset"): string {
    switch (op) {
        case "set":
            return "=";
        case "increment":
            return "+=";
        case "decrement":
            return "-=";
        case "multiply":
            return "*=";
        case "divide":
            return "/=";
        case "unset":
            return "unset";
    }
}

export function generateValue(value: Value): string {
    return value;
}

export function generateBlock(actions: Action[]): string {
    if (actions.length === 1) {
        return `{ ${generateAction(actions[0])} }`;
    }

    const res: string[] = [];

    res.push("{");
    for (const action of actions) {
        res.push(`    ${generateAction(action)}`);
    }
    res.push("}");

    return res.join("\n");
}

export function generateConditions(conditions: Condition[]): string {
    return "()";
}
