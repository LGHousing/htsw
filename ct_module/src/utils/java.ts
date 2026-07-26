/// <reference types="../../CTAutocomplete" />

export function javaType<K extends keyof HtswJavaTypeMap>(name: K): HtswJavaTypeMap[K] {
    return Java.type(name) as HtswJavaTypeMap[K];
}

export type RuntimeString = string | { toString(): string };

export function runtimeString(value: RuntimeString | null | undefined): string {
    if (value === null || value === undefined) return "";
    return typeof value === "string" ? value : String(value);
}

let minecraft: HtswMinecraft | null = null;

export function getMinecraft(): HtswMinecraft {
    if (minecraft !== null) return minecraft;
    const current = (
        Client as unknown as {
            getMinecraft(): HtswMinecraft | null | undefined;
        }
    ).getMinecraft();
    if (current !== null && current !== undefined) minecraft = current;
    return current as HtswMinecraft;
}

export function sendPacket(packet: HtswPacketInstance): void {
    (Client as unknown as HtswClientClass).sendPacket(packet);
}

export function getPlayer(): HtswMinecraftPlayer {
    const player = (Player as unknown as HtswPlayerClass).getPlayer();
    if (player === null || player === undefined) {
        throw new Error("No player is loaded");
    }
    return player;
}

export function showTitle(
    title: string,
    subtitle: string,
    fadeIn: number,
    time: number,
    fadeOut: number
): void {
    (Client as unknown as HtswClientClass).showTitle(
        title,
        subtitle,
        fadeIn,
        time,
        fadeOut
    );
}
