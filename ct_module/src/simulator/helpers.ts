import { Gamemode } from "htsw/types";

export function getGamemode(): Gamemode {
    const player = Player.getPlayer();
    const gameType = player
        .func_178889_l /*getCurrentGameType*/
        ();

    if (
        gameType
            .func_77145_d /*isCreative*/
            ()
    ) {
        return "Creative";
    } else if (
        gameType
            .func_82752_c /*isAdventure*/
            ()
    ) {
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

export function coerceWithin(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
