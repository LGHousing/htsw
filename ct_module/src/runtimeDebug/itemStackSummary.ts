import { removedFormatting } from "../utils/helpers";
import { javaType } from "../utils/java";

export type ItemStackSummary = {
    name: string;
    cleanName: string;
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

function stackName(stack: unknown): string {
    try {
        return String((stack as { func_82833_r(): unknown }).func_82833_r());
    } catch (_e) {
        return "<stack>";
    }
}

function stackId(stack: unknown): string | null {
    try {
        const ItemClass = javaType("net.minecraft.item.Item");
        const item = (
            stack as { func_77973_b(): HtswMinecraftItem | null }
        ).func_77973_b();
        if (item === null) return null;
        const key = ItemClass.field_150901_e.func_148750_c(item);
        return key === null ? null : key.toString();
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
        const tag = (
            stack as { func_77978_p(): HtswMinecraftNbtCompound | null }
        ).func_77978_p();
        return tag === null ? null : tag.toString();
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
        cleanName: removedFormatting(name),
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
