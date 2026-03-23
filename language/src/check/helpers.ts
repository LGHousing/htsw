import type { GlobalCtxt } from "../context";
import type { Tag } from "../nbt";
import type { Action } from "../types";

export function getActions(gcx: GlobalCtxt): Action[] {
    const res: Action[] = [];

    for (const importable of gcx.importables) {
        if (importable.type === "FUNCTION") {
            res.push(...importable.actions);
        }

        else if (importable.type === "REGION") {
            res.push(...importable.onEnterActions ?? []);
            res.push(...importable.onExitActions ?? []);
        }

        else if (importable.type === "EVENT") {
            res.push(...importable.actions);
        }

        else if (importable.type === "ITEM") {
            res.push(...importable.leftClickActions ?? []);
            res.push(...importable.rightClickActions ?? []);
        }
    }

    return res;
}

export function getTags(gcx: GlobalCtxt): Tag[] {
    const res: Tag[] = [];

    for (const importable of gcx.importables) {
        if (importable.type === "ITEM") {
            res.push(importable.nbt);
        }
    }

    return res;
}