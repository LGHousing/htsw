import { VERSION } from "htsw";

import { getDate, getGamemode, randomLong } from "./helpers";
import { Var, VarString, VarLong, VarDouble, parseValue } from "./vars";
import { Simulator } from "./simulator";
import Long from "long";

const MOCK_DATA = {
    server: {
        name: "mini76AH",
        shortname: "m76AH",
    },
    player: {
        version: "1.8.X",
        protocol: 47,
        region: {
            name: "None",
        },
        group: {
            name: "Owner",
            tag: "&e[OWNER]",
            priority: 100,
            color: "",
        },
        team: {
            name: "No Team",
            tag: "",
            color: "",
            players: 0,
        },
        parkour: {
            ticks: 0,
            formatted: "00:00",
        },
    },
    house: {
        name: `HTSL Runtime ${VERSION}`,
        guests: 0,
        cookies: 0,
        visitingrules: "&cPRIVATE",
        players: 1,
    },
} as const;

const PLACEHOLDER_REGEX = /%([^%]+?)%/g;

/**
 * Replaces placeholders in a string.
 */
export function replacePlaceholders(value: string): string {
    const placeholders = value.match(PLACEHOLDER_REGEX);

    if (!placeholders) {
        return value;
    }

    for (const placeholder of placeholders) {
        const placeholderContent = placeholder.substring(1, placeholder.length - 1);
        try {
            const evaluatedVar = parsePlaceholder(placeholderContent);

            value = value.replace(placeholder, evaluatedVar.toString());
        } catch (error) {
            /* Ignore */
        }
    }

    return value;
}

/**
 * Parses a placeholder string into its components and evaluates it using
 * runPlaceholder.
 *
 * @param placeholderContent - The raw undelimited placeholder
 * @throws An error if a placeholder evaluates to undefined
 * (the parser should prevent this, if it doesn't, it's a bug).
 */
export function parsePlaceholder(placeholder: string): Var<any> {
    const [name, argsString] = placeholder.split("/");

    let args: string[] = [];
    if (argsString) {
        args = argsString.split(" ").filter((arg) => arg);
        if (args.length === 0) args = [""]; // Fixes weird parsing by hypixles :)
    }

    const result = runPlaceholder(name, ...args);

    if (result === undefined) {
        throw new Error(`Placeholder "${name}" could not be resolved.`);
    }

    return result;
}

export function runPlaceholder(name: string, ...args: string[]): Var<any> | undefined {
    switch (name) {
        case "server.name":
            return new VarString(MOCK_DATA.server.name);
        case "server.shortname":
            return new VarString(MOCK_DATA.server.name);

        case "player.name":
            return new VarString(Player.getName());
        case "player.ping":
            return VarLong.fromNumber(Server.getPing());
        case "player.health":
            return VarLong.fromNumber(Player.getHP());
        case "player.maxhealth":
            return VarLong.fromNumber(
                Player.getPlayer()
                    .func_110138_aP /*getMaxHealth*/
                    ()
            );
        case "player.hunger":
            return VarLong.fromNumber(Player.getHunger());
        case "player.experience":
            return VarLong.fromNumber(Player.getXPProgress());
        case "player.level":
            return VarLong.fromNumber(Player.getXPLevel());
        case "player.version":
            return new VarString(MOCK_DATA.player.version);
        case "player.protocol":
            return VarLong.fromNumber(MOCK_DATA.player.protocol);
        case "player.gamemode":
            return new VarString(getGamemode().toUpperCase());
        case "player.region.name":
            return new VarString(MOCK_DATA.player.region.name);
        case "player.pos.x":
            return new VarDouble(Player.getX());
        case "player.pos.y":
            return new VarDouble(Player.getY());
        case "player.pos.z":
            return new VarDouble(Player.getZ());
        case "player.pos.pitch":
            return new VarDouble(Player.getPitch());
        case "player.pos.yaw":
            return new VarDouble(Player.getYaw());
        case "player.block.x":
            return VarLong.fromNumber(Math.floor(Player.getX()));
        case "player.block.y":
            return VarLong.fromNumber(Math.floor(Player.getY()));
        case "player.block.z":
            return VarLong.fromNumber(Math.floor(Player.getZ()));
        case "player.group.name":
            return new VarString(MOCK_DATA.player.group.name);
        case "player.group.tag":
            return new VarString(MOCK_DATA.player.group.tag);
        case "player.group.priority":
            return VarLong.fromNumber(MOCK_DATA.player.group.priority);
        case "player.group.color":
            return new VarString(MOCK_DATA.player.group.color);
        case "player.team.name":
            return new VarString(MOCK_DATA.player.team.name);
        case "player.team.tag":
            return new VarString(MOCK_DATA.player.team.tag);
        case "player.team.color":
            return new VarString(MOCK_DATA.player.team.color);
        case "player.team.players":
            return runPlaceholderPlayerTeamPlayers(args);
        case "player.parkour.ticks":
            return VarLong.fromNumber(MOCK_DATA.player.parkour.ticks);
        case "player.parkour.formatted":
            return new VarString(MOCK_DATA.player.parkour.formatted);

        case "house.name":
            return new VarString(MOCK_DATA.house.name);
        case "house.guests":
            return VarLong.fromNumber(MOCK_DATA.house.guests);
        case "house.cookies":
            return VarLong.fromNumber(MOCK_DATA.house.cookies);
        case "house.visitingrules":
            return new VarString(MOCK_DATA.house.visitingrules);
        case "house.players":
            return VarLong.fromNumber(MOCK_DATA.house.players);

        case "date.day":
            return runPlaceholderDateDay(args);
        case "date.month":
            return runPlaceholderDateMonth(args);
        case "date.year":
            return runPlaceholderDateYear(args);
        case "date.hour":
            return runPlaceholderDateHour(args);
        case "date.minute":
            return runPlaceholderDateMinute(args);
        case "date.seconds":
            return runPlaceholderDateSeconds(args);
        case "date.unix":
            return VarLong.fromNumber(Math.floor(Date.now() / 1000));
        case "date.unix.ms":
            return VarLong.fromNumber(Date.now());

        case "random.whole":
            return runPlaceholderRandomWhole(args);
        case "random.decimal":
            return runPlaceholderRandomDecimal(args);

        case "var.player":
            return runPlaceholderVarPlayer(args);
        case "var.global":
            return runPlaceholderVarGlobal(args);
        case "var.team":
            return runPlaceholderVarTeam(args);
    }
}

function runPlaceholderPlayerTeamPlayers(args: string[]): Var<any> | undefined {
    if (args.length > 1) return VarLong.fromNumber(0);
    return VarLong.fromNumber(MOCK_DATA.player.team.players);
}

function runPlaceholderDateDay(args: string[]): Var<any> | undefined {
    const date = getDate(args[0]);
    return VarLong.fromNumber(date.getDate());
}

function runPlaceholderDateMonth(args: string[]): Var<any> | undefined {
    const date = getDate(args[0]);
    return VarLong.fromNumber(date.getMonth());
}

function runPlaceholderDateYear(args: string[]): Var<any> | undefined {
    const date = getDate(args[0]);
    return VarLong.fromNumber(date.getFullYear());
}

function runPlaceholderDateHour(args: string[]): Var<any> | undefined {
    const date = getDate(args[0]);
    return VarLong.fromNumber(date.getHours());
}

function runPlaceholderDateMinute(args: string[]): Var<any> | undefined {
    const date = getDate(args[0]);
    return VarLong.fromNumber(date.getMinutes());
}

function runPlaceholderDateSeconds(args: string[]): Var<any> | undefined {
    const date = getDate(args[0]);
    return VarLong.fromNumber(date.getSeconds());
}

function runPlaceholderRandomWhole(args: string[]): Var<any> | undefined {
    if (args.length === 0) {
        // default random, which is there for some reason
        return VarLong.fromNumber(Math.floor(Math.random() * 100_000));
    }
    if (args.length !== 2) return VarLong.fromNumber(0);

    if (!/^-?\d+$/.test(args[0]) || !/^-?\d+$/.test(args[1])) {
        return VarLong.fromNumber(0);
    }

    const min = Long.fromString(args[0]);
    const max = Long.fromString(args[1]);

    if (max.lte(min)) {
        return VarLong.fromNumber(0);
    }

    const range = max.subtract(min).add(1);
    let rand;
    do {
        rand = randomLong().mod(range).add(min);
    } while (rand.lessThan(min) || rand.greaterThan(max));

    return new VarLong(rand);
}

function runPlaceholderRandomDecimal(args: string[]): Var<any> | undefined {
    if (args.length === 0) return new VarDouble(Math.random());
    if (args.length !== 2) return new VarDouble(0);

    if (
        !(args[0].includes(".") && !isNaN(Number(args[0]))) ||
        !(args[1].includes(".") && !isNaN(Number(args[1])))
    ) {
        return new VarDouble(0);
    }

    const min = Number(args[0]);
    const max = Number(args[1]);

    if (max <= min) {
        return new VarDouble(0);
    }

    return new VarDouble(Math.random() * (max - min) + min);
}

function runPlaceholderVarPlayer(args: string[]): Var<any> | undefined {
    const key = args[0];
    return Simulator.playerVars.getVar(key, parseValue(args[1] ?? '""'));
}

function runPlaceholderVarGlobal(args: string[]): Var<any> | undefined {
    const key = args[0];
    return Simulator.globalVars.getVar(key, parseValue(args[1] ?? '""'));
}

function runPlaceholderVarTeam(args: string[]): Var<any> | undefined {
    const key = args[0];
    const team = args[1];
    return Simulator.teamVars.getVar({ key, team }, parseValue(args[2] ?? '""'));
}
