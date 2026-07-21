import type { Action } from "htsw/types";

import { actionListCompareKey } from "../../housingSync/actions/comparison";
import { canonicalItemShellTagKey } from "../../housingSync/items/itemNbt";
import type { TagLike } from "../../housingSync/items/itemTag";
import { stableStringify } from "../../utils/helpers";

const MENU_SLOT_PARSE_PATH_KEYS = new Set(["sourcePath", "actionsPath", "nbtPath"]);

function menuSlotNbtCompareKey(nbt: unknown): string {
    if (
        nbt === null ||
        typeof nbt !== "object" ||
        (nbt as { type?: unknown }).type !== "compound"
    ) {
        return stableStringify(nbt);
    }
    return canonicalItemShellTagKey(nbt as TagLike);
}

export function menuSlotCompareKey(slot: Record<string, unknown>): string {
    const keys = Object.keys(slot).sort();
    const parts: string[] = [];
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (MENU_SLOT_PARSE_PATH_KEYS.has(key)) continue;
        const value = slot[key];
        if (value === undefined) continue;
        if (Array.isArray(value) && value.length === 0) continue;

        let serialized: string;
        if (key === "actions" && Array.isArray(value)) {
            serialized = actionListCompareKey(value as Action[]);
        } else if (key === "nbt") {
            serialized = menuSlotNbtCompareKey(value);
        } else {
            serialized = stableStringify(value);
        }
        parts.push(JSON.stringify(key) + ":" + serialized);
    }
    return "{" + parts.join(",") + "}";
}
