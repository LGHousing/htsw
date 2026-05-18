/// <reference types="../../../CTAutocomplete" />

declare const Java: {
    type(name: string): any;
};

export function javaType<T = any>(name: string): T {
    return Java.type(name) as T;
}

export const GL11: any = javaType("org.lwjgl.opengl.GL11");
