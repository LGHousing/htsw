/// <reference types="../../../CTAutocomplete" />

import { javaType } from "../../utils/java";

export {
    getMinecraft,
    javaType,
    runtimeString,
    type RuntimeString,
} from "../../utils/java";

type JavaArrayLike = {
    readonly length: unknown;
    [index: number]: unknown;
};

export function javaArrayLength(value: unknown): number {
    if (value === null || value === undefined) return -1;
    const array = value as JavaArrayLike;
    try {
        if (typeof array.length === "number") return array.length;
    } catch (_error) {}
    return -1;
}

export function javaArrayAt(value: unknown, index: number): unknown {
    if (value === null || value === undefined) return null;
    try {
        return (value as JavaArrayLike)[index];
    } catch (_error) {
        return null;
    }
}

export const GL11 = javaType("org.lwjgl.opengl.GL11");
