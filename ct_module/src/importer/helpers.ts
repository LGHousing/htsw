import { ACTION_NAMES, Action, SOUNDS } from "htsw/types";
import TaskContext from "../tasks/context";

export function booleanAsValue(value: boolean): string {
    return value ? "Enabled" : "Disabled";
}

export function numberAsValue(value: number): string {
    return value.toString();
}

export function stringAsValue(value: string): string {
    return value;
}

// TODO export this if needed, else remove
function soundPathToName(path: string): string | null {
    for (const sound of SOUNDS) {
        if (sound.path === path) return sound.name;
    }
    return null;
}

export async function findAndClickSlot(
    ctx: TaskContext,
    identifier: string
): Promise<boolean> {}
