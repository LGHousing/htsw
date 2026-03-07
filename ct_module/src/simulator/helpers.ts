import { Gamemode, Location } from "htsw/types";

import { Long } from "htsw";

export type BlockPos = { x: number; y: number; z: number };

export function getGamemode(): Gamemode {
    const player = Player.getPlayer();
    const gameType = player.func_178889_l/*getCurrentGameType*/();

    if (gameType.func_77145_d/*isCreative*/()) {
        return "Creative";
    } else if (gameType.func_82752_c/*isAdventure*/()) {
        return "Adventure";
    } else {
        return "Survival";
    }
}

export function getDate(timezone?: string): Date {
    let date = new Date();
    if (timezone) {
        date = new Date(date.toLocaleString("en-US", { timeZone: timezone }));
    }
    return date;
}

export function randomLong(): Long {
    const lo = Math.floor(Math.random() * 0x100000000);
    const hi = Math.floor(Math.random() * 0x100000000);

    return Long.fromBits(lo, hi, false);
}

export function getBlockPos(location: Location): BlockPos | undefined {
    if (location.type === "Invokers Location") {
        return { x: Player.getX(), y: Player.getY(), z: Player.getZ() };
    } else if (location.type === "Custom Coordinates") {
        return { x: 0, y: 0, z: 0 };
    }
}

export function formatNumber(number: string): string {
    const [whole, decimal = ""] = number.split(".");

    let formattedWhole = "";
    for (let i = whole.length - 1, count = 0; i >= 0; i--, count++) {
        formattedWhole = whole[i] + formattedWhole;
        if (count === 2 && i !== 0) {
            formattedWhole = "," + formattedWhole;
            count = -1;
        }
    }

    if (!decimal) return formattedWhole;

    let roundedDecimal = Math.floor((+(decimal + "0000").slice(0, 4) + 5) / 10).toString();
    while (roundedDecimal.length < 3) roundedDecimal = "0" + roundedDecimal;

    return formattedWhole + "." + roundedDecimal.replace(/0+$/, "");
}

export function coerceWithin(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

export function isLong(value: string): boolean {
    return value == Long.fromString(value).toString();
}

export function parseLong(value: string): Long {
    const long = Long.fromString(value);

    if (value !== long.toString()) {
        return value.startsWith("-")
            ? Long.fromString("9223372036854775807")
            : Long.fromString("-9223372036854775808");
    } else {
        return long;
    }
}
