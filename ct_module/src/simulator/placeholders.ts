import { VERSION, runtime } from "htsw";

import { getDate, getGamemode } from "./helpers";
import { Simulator } from "./simulator";

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

export function replacePlaceholders(value: string): string {
    const placeholders = value.match(PLACEHOLDER_REGEX);
    if (!placeholders) return value;

    for (const placeholder of placeholders) {
        const placeholderContent = placeholder.substring(1, placeholder.length - 1);
        try {
            const evaluatedVar = Simulator.runtime.runPlaceholder(placeholderContent);
            if (!evaluatedVar) continue;
            value = value.replace(placeholder, evaluatedVar.toString());
        } catch (_error) {
            // Ignore unresolved placeholders in UI strings.
        }
    }

    return value;
}

export function createPlaceholderBehaviors(vars: runtime.simple.Vars): runtime.PlaceholderBehaviors {
    return new runtime.simple.SimplePlaceholderBehaviors(vars)
        .with("server.name", () => new runtime.VarString(MOCK_DATA.server.name))
        .with("server.shortname", () => new runtime.VarString(MOCK_DATA.server.shortname))
        .with("player.name", () => new runtime.VarString(Player.getName()))
        .with("player.ping", () => runtime.VarLong.fromNumber(Server.getPing()))
        .with("player.health", () => runtime.VarLong.fromNumber(Player.getHP()))
        .with("player.maxhealth", () =>
            runtime.VarLong.fromNumber(
                Player.getPlayer()
                    .func_110138_aP /*getMaxHealth*/
                    ()
            )
        )
        .with("player.hunger", () => runtime.VarLong.fromNumber(Player.getHunger()))
        .with("player.experience", () =>
            runtime.VarLong.fromNumber(Player.getXPProgress())
        )
        .with("player.level", () => runtime.VarLong.fromNumber(Player.getXPLevel()))
        .with("player.version", () => new runtime.VarString(MOCK_DATA.player.version))
        .with("player.protocol", () =>
            runtime.VarLong.fromNumber(MOCK_DATA.player.protocol)
        )
        .with("player.gamemode", () => new runtime.VarString(getGamemode().toUpperCase()))
        .with(
            "player.region.name",
            () => new runtime.VarString(MOCK_DATA.player.region.name)
        )
        .with("player.pos.x", () => new runtime.VarDouble(Player.getX()))
        .with("player.pos.y", () => new runtime.VarDouble(Player.getY()))
        .with("player.pos.z", () => new runtime.VarDouble(Player.getZ()))
        .with("player.pos.pitch", () => new runtime.VarDouble(Player.getPitch()))
        .with("player.pos.yaw", () => new runtime.VarDouble(Player.getYaw()))
        .with("player.block.x", () =>
            runtime.VarLong.fromNumber(Math.floor(Player.getX()))
        )
        .with("player.block.y", () =>
            runtime.VarLong.fromNumber(Math.floor(Player.getY()))
        )
        .with("player.block.z", () =>
            runtime.VarLong.fromNumber(Math.floor(Player.getZ()))
        )
        .with(
            "player.group.name",
            () => new runtime.VarString(MOCK_DATA.player.group.name)
        )
        .with("player.group.tag", () => new runtime.VarString(MOCK_DATA.player.group.tag))
        .with("player.group.priority", () =>
            runtime.VarLong.fromNumber(MOCK_DATA.player.group.priority)
        )
        .with(
            "player.group.color",
            () => new runtime.VarString(MOCK_DATA.player.group.color)
        )
        .with("player.team.name", () => new runtime.VarString(MOCK_DATA.player.team.name))
        .with("player.team.tag", () => new runtime.VarString(MOCK_DATA.player.team.tag))
        .with(
            "player.team.color",
            () => new runtime.VarString(MOCK_DATA.player.team.color)
        )
        .with("player.team.players", behaviorPlayerTeamPlayers)
        .with("player.parkour.ticks", () =>
            runtime.VarLong.fromNumber(MOCK_DATA.player.parkour.ticks)
        )
        .with(
            "player.parkour.formatted",
            () => new runtime.VarString(MOCK_DATA.player.parkour.formatted)
        )
        .with("house.name", () => new runtime.VarString(MOCK_DATA.house.name))
        .with("house.guests", () => runtime.VarLong.fromNumber(MOCK_DATA.house.guests))
        .with("house.cookies", () => runtime.VarLong.fromNumber(MOCK_DATA.house.cookies))
        .with(
            "house.visitingrules",
            () => new runtime.VarString(MOCK_DATA.house.visitingrules)
        )
        .with("house.players", () => runtime.VarLong.fromNumber(MOCK_DATA.house.players))
        .with("date.day", behaviorDateDay)
        .with("date.month", behaviorDateMonth)
        .with("date.year", behaviorDateYear)
        .with("date.hour", behaviorDateHour)
        .with("date.minute", behaviorDateMinute)
        .with("date.seconds", behaviorDateSeconds)
        .with("date.unix", () =>
            runtime.VarLong.fromNumber(Math.floor(Date.now() / 1000))
        )
        .with("date.unix.ms", () => runtime.VarLong.fromNumber(Date.now()));
}

function behaviorPlayerTeamPlayers(
    _rt: runtime.Runtime,
    invocation: runtime.PlaceholderInvocation
): runtime.Var<any> {
    if (invocation.args.length > 1) return runtime.VarLong.fromNumber(0);
    return runtime.VarLong.fromNumber(MOCK_DATA.player.team.players);
}

function behaviorDateDay(
    _rt: runtime.Runtime,
    invocation: runtime.PlaceholderInvocation
): runtime.Var<any> {
    return runtime.VarLong.fromNumber(getDate(invocation.args[0]).getDate());
}

function behaviorDateMonth(
    _rt: runtime.Runtime,
    invocation: runtime.PlaceholderInvocation
): runtime.Var<any> {
    return runtime.VarLong.fromNumber(getDate(invocation.args[0]).getMonth());
}

function behaviorDateYear(
    _rt: runtime.Runtime,
    invocation: runtime.PlaceholderInvocation
): runtime.Var<any> {
    return runtime.VarLong.fromNumber(getDate(invocation.args[0]).getFullYear());
}

function behaviorDateHour(
    _rt: runtime.Runtime,
    invocation: runtime.PlaceholderInvocation
): runtime.Var<any> {
    return runtime.VarLong.fromNumber(getDate(invocation.args[0]).getHours());
}

function behaviorDateMinute(
    _rt: runtime.Runtime,
    invocation: runtime.PlaceholderInvocation
): runtime.Var<any> {
    return runtime.VarLong.fromNumber(getDate(invocation.args[0]).getMinutes());
}

function behaviorDateSeconds(
    _rt: runtime.Runtime,
    invocation: runtime.PlaceholderInvocation
): runtime.Var<any> {
    return runtime.VarLong.fromNumber(getDate(invocation.args[0]).getSeconds());
}
