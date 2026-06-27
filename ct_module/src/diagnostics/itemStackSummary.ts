import { removedFormatting } from "../utils/helpers";

export type ItemStackSummary = {
    name: string | null;
    cleanName: string | null;
    id: string | null;
    damage: number | null;
    count: number | null;
    hasTag: boolean | null;
    tagHash?: string;
    tagLength?: number;
};

function javaStringHash(value: string): string {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    }
    return String(hash);
}

function stackName(stack: unknown): string | null {
    if (stack === null || stack === undefined) return null;
    try {
        return String((stack as { func_82833_r(): string }).func_82833_r());
    } catch (_e) {
        return "<stack>";
    }
}

function stackId(stack: unknown): string | null {
    try {
        const ItemClass = Java.type("net.minecraft.item.Item");
        const item = (stack as { func_77973_b(): unknown }).func_77973_b();
        const key = (ItemClass as any).field_150901_e.func_148750_c(item);
        return key === null || key === undefined ? null : String(key);
    } catch (_e) {
        return null;
    }
}

function stackDamage(stack: unknown): number | null {
    try {
        const damage = (stack as { func_77960_j(): number }).func_77960_j();
        return typeof damage === "number" ? damage : null;
    } catch (_e) {
        return null;
    }
}

function stackCount(stack: unknown): number | null {
    try {
        const count = (stack as { field_77994_a?: number }).field_77994_a;
        return typeof count === "number" ? count : null;
    } catch (_e) {
        return null;
    }
}

function stackTagText(stack: unknown): string | null {
    try {
        const tag = (stack as { func_77978_p(): unknown }).func_77978_p();
        return tag === null || tag === undefined ? null : String(tag);
    } catch (_e) {
        return null;
    }
}

export function summarizeItemStack(stack: unknown): ItemStackSummary | null {
    if (stack === null || stack === undefined) return null;
    const name = stackName(stack);
    const tagText = stackTagText(stack);
    const summary: ItemStackSummary = {
        name,
        cleanName: name === null ? null : removedFormatting(name),
        id: stackId(stack),
        damage: stackDamage(stack),
        count: stackCount(stack),
        hasTag: tagText !== null,
    };
    if (tagText !== null) {
        summary.tagHash = javaStringHash(tagText);
        summary.tagLength = tagText.length;
    }
    return summary;
}
