import { Long } from "../../long";
import type { TyCtxt } from "./context";
import { doubleConst, doubleRange, longConst, longRange, string, unknownDouble, unknownLong, unknownString, type VarState } from "./state";

export function parseValue(tcx: TyCtxt, value: string): VarState | undefined {
    if (!value) {
        throw Error("Value cannot be null or empty");
    }

    if (value.startsWith("%") && value.endsWith("%") && value.length > 2) {
        const content = value.substring(1, value.length - 1);
        return parsePlaceholder(tcx, content);
    }

    if (value.startsWith('"') && value.endsWith('"')) {
        const content = value.substring(1, value.length - 1);
        return parseString(tcx, content);
    }

    if (value.includes(".") && !isNaN(Number(value))) {
        return doubleConst(Number(value));
    }

    if (/^-?\d+$/.test(value)) {
        return longConst(Long.fromString(value));
    }

    throw Error("Invalid value type")
}

const PLACEHOLDER_REGEX = /%([^%]+?)%/g;
const ONE_PLACEHOLDER_REGEX = /^%([^%]+?)%$/;
const OBVIOUS_CAST_REGEX = /^%([^%]+?)%(L|D)$/;

function parseString(tcx: TyCtxt, value: string): VarState | undefined {
    const placeholders = value.match(PLACEHOLDER_REGEX);

    if (!placeholders) {
        return string(value);
    }

    if (ONE_PLACEHOLDER_REGEX.test(value)) {
        const placeholder = value.slice(1, -1);
        return parsePlaceholder(tcx, placeholder);
    }

    if (OBVIOUS_CAST_REGEX.test(value)) {
        const placeholder = value.slice(1, -2);
        const state = parsePlaceholder(tcx, placeholder);
        if (!state) return;

        if (state.type !== "string") {
            if (value.charAt(value.length - 1) === "L") {
                return unknownLong();
            } else {
                return unknownDouble();
            }
        }
    }
}

function parsePlaceholder(tcx: TyCtxt, placeholder: string): VarState | undefined {
    const pivotIndex = placeholder.indexOf("/");
    const name = pivotIndex === -1 ? placeholder : placeholder.substring(0, pivotIndex);
    const argsString = pivotIndex === -1 ? "" : placeholder.substring(pivotIndex + 1);

    let args: string[] = [];
    if (argsString) {
        args = argsString.split(" ").filter((arg) => arg);
        if (args.length === 0) args = [""]; // Fixes weird parsing by hypixles :)
    }

    return runPlaceholder(tcx, name, ...args);
}

export function runPlaceholder(tcx: TyCtxt, name: string, ...args: string[]): VarState | undefined {
    switch (name) {
        case "server.name":
            return unknownString();
        case "server.shortname":
            return unknownString();
        case "player.name":
            return unknownString();
        case "player.ping":
            return unknownLong();
        case "player.health":
            return longRange(Long.fromNumber(0), Long.fromNumber(20));
        case "player.maxhealth":
            return unknownLong();
        case "player.hunger":
            return longRange(Long.fromNumber(0), Long.fromNumber(20));
        case "player.experience":
            return unknownLong();
        case "player.level":
            return unknownLong();
        case "player.version":
            return unknownString();
        case "player.protocol":
            return unknownLong();
        case "player.gamemode":
            return unknownString();
        case "player.region.name":
            return unknownString();
        case "player.pos.x":
            return unknownDouble();
        case "player.pos.y":
            return unknownDouble();
        case "player.pos.z":
            return unknownDouble();
        case "player.pos.pitch":
            return doubleRange(-90, 90);
        case "player.pos.yaw":
            return doubleRange(-180, 180);
        case "player.block.x":
            return unknownLong();
        case "player.block.y":
            return unknownLong();
        case "player.block.z":
            return unknownLong();
        case "player.group.name":
            return unknownString();
        case "player.group.tag":
            return unknownString();
        case "player.group.priority":
            return longRange(Long.fromNumber(1), Long.fromNumber(20));
        case "player.group.color":
            return unknownString();
        case "player.team.name":
            return unknownString();
        case "player.team.tag":
            return unknownString();
        case "player.team.color":
            return unknownString();
        case "player.team.players":
            return longRange(Long.fromNumber(0), Long.fromNumber(250));
        case "player.parkour.ticks":
            return unknownLong();
        case "player.parkour.formatted":
            return unknownString();
        case "house.name":
            return unknownString();
        case "house.guests":
            return longRange(Long.fromNumber(0), Long.fromNumber(250));
        case "house.cookies":
            return unknownString();
        case "house.visitingrules":
            return unknownString();
        case "house.players":
            return longRange(Long.fromNumber(0), Long.fromNumber(250));
        case "date.day":
            return longRange(Long.fromNumber(1), Long.fromNumber(31));
        case "date.month":
            return longRange(Long.fromNumber(1), Long.fromNumber(12));
        case "date.year":
            return unknownLong();
        case "date.hour":
            return longRange(Long.fromNumber(0), Long.fromNumber(24));
        case "date.minute":
            return longRange(Long.fromNumber(0), Long.fromNumber(60));
        case "date.seconds":
            return longRange(Long.fromNumber(0), Long.fromNumber(60));
        case "date.unix":
            return unknownLong();
        case "date.unix.ms":
            return unknownLong();
        case "random.whole":
            if (args.length === 0) {
                return longRange(Long.fromNumber(0), Long.fromNumber(100000));
            }
            if (args.length !== 2) return longConst(Long.fromNumber(0));

            if (!/^-?\d+$/.test(args[0]) || !/^-?\d+$/.test(args[1])) {
                return longConst(Long.fromNumber(0));
            }

            return longRange(Long.fromString(args[0]), Long.fromString(args[1]));
        case "random.decimal":
            if (args.length === 0) {
                return doubleRange(0, 1);
            }
            if (args.length !== 2) return doubleConst(0);

            if (!/^-?\d+$/.test(args[0]) || !/^-?\d+$/.test(args[1])) {
                return doubleConst(0);
            }

            return doubleRange(Number(args[0]), Number(args[1]));
        case "var.player":
            const pkey = { holder: { type: "Player" }, key: args[0] } as const;

            if (tcx.hasState(pkey)) {
                return tcx.getState(pkey)!;
            } else {
                return undefined;
            }
        case "var.global":
            const gkey = { holder: { type: "Global" }, key: args[0] } as const;

            if (tcx.hasState(gkey)) {
                return tcx.getState(gkey)!;
            } else {
                return undefined;
            }
        case "var.team":
            const tkey = { holder: { type: "Team", team: args[1] }, key: args[0] } as const;
            
            if (tcx.hasState(tkey)) {
                return tcx.getState(tkey)!;
            } else {
                return undefined;
            }
        default:
            return unknownString(); // Just a raw placeholder, I guess
    }
}
