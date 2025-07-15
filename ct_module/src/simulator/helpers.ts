import { Gamemode, Location } from "housing-common";
import Long from "long";

export type BlockPos = { x: number, y: number, z: number }

export function getGamemode(): Gamemode {
    const player = Player.getPlayer();
    const gameType = player.func_178889_l/*getCurrentGameType*/();
    
    if (gameType.func_77145_d/*isCreative*/()) {
        return "creative";
    } else if (gameType.func_82752_c/*isAdventure*/()) {
        return "adventure"
    } else {
        return "survival";
    }
}

export function getDate(timezone?: string): Date {
    let date = new Date();
    if (timezone) { 
        date = new Date(
            date.toLocaleString('en-US', { timeZone: timezone })
        );
    }
    return date;
}

export function randomLong(): Long {
    const lo = Math.floor(Math.random() * 0x100000000);
    const hi = Math.floor(Math.random() * 0x100000000);

    return Long.fromBits(lo, hi, false);
}

export function getBlockPos(location: Location): BlockPos | undefined {
    if (location.type === "location_invokers") {
        return { x: Player.getX(), y: Player.getY(), z: Player.getZ() }
    } else if (location.type === "location_custom") {
        
        return { x: 0, y: 0, z: 0 };
    }
}

export function formatNumber(number: string): string {
    console.log(number);
    const [whole, decimal] = number.split(".");

    let formattedWhole = "";
    for (let i = whole.length - 1, count = 0; i >= 0; i--, count++) {
        formattedWhole = whole[i] + formattedWhole;
        if (count === 2 && i !== 0) {
            formattedWhole = "," + formattedWhole;
            count = -1;
        }
    }

    if (decimal) {
        const formattedDecimal = decimal.substring(0, 3);
        return `${formattedWhole}.${formattedDecimal}`;
    } else {
        return formattedWhole;
    }
}

export function coerceWithin(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}