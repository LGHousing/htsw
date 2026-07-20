/// <reference types="../../CTAutocomplete" />

export function javaType<K extends keyof HtswJavaTypeMap>(name: K): HtswJavaTypeMap[K] {
    return Java.type(name) as HtswJavaTypeMap[K];
}

export type RuntimeString = string | { toString(): string };

export function runtimeString(value: RuntimeString | null | undefined): string {
    if (value === null || value === undefined) return "";
    return typeof value === "string" ? value : String(value);
}

export function getMinecraft(): HtswMinecraft {
    return (
        Client as unknown as {
            getMinecraft(): HtswMinecraft;
        }
    ).getMinecraft();
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
