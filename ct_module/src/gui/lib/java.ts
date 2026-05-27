/// <reference types="../../../CTAutocomplete" />

declare const Java: {
    type(name: string): any;
};

export function javaType<T = any>(name: string): T {
    return Java.type(name) as T;
}

export const GL11: any = javaType("org.lwjgl.opengl.GL11");

export function getMtimeMs(path: string): number {
    try {
        const Paths = javaType("java.nio.file.Paths");
        const Files = javaType("java.nio.file.Files");
        return Number(Files.getLastModifiedTime(Paths.get(String(path))).toMillis());
    } catch (_e) {
        return 0;
    }
}
