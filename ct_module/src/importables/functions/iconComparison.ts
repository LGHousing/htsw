import type { FunctionIcon } from "htsw/types";

import { stableStringify } from "../../utils/helpers";

function iconCompareKey(icon: FunctionIcon): string {
    const normalized: Record<string, unknown> = { ...icon };
    if (typeof normalized.item === "string" && normalized.item.indexOf(":") < 0) {
        normalized.item = "minecraft:" + normalized.item.toLowerCase();
    }
    if (normalized.count === 1) delete normalized.count;
    if (normalized.enchanted !== true) delete normalized.enchanted;
    return stableStringify(normalized);
}

const DEFAULT_FUNCTION_ICON_KEY = iconCompareKey({ item: "minecraft:map" });

export function functionIconCompareKey(icon: FunctionIcon | undefined): string | null {
    if (icon === undefined) return null;
    const key = iconCompareKey(icon);
    return key === DEFAULT_FUNCTION_ICON_KEY ? null : key;
}

export function functionIconsEqual(
    left: FunctionIcon | undefined,
    right: FunctionIcon | undefined
): boolean {
    return functionIconCompareKey(left) === functionIconCompareKey(right);
}
