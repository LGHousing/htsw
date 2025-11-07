import { knownRange, unknown, type VariableType } from "./htsl/typecheck/state";
import type { Value, VarHolder, VarName } from "./types";

const BUILTIN_PLACEHOLDERS: Record<string, VariableType> = {
    // TODO fill in this shit
    "%player.health%": unknown("long"),
    "%player.pos.x%": unknown("double"),
    "%player.pos.y%": unknown("double"),
    "%player.pos.z%": unknown("double"),
    "%player.pos.pitch%": knownRange("double", -90, 90),
    "%player.pos.yaw%": knownRange("double", -180, 180),
};

const PLACEHOLDER_PLAYER_VAR_REGEX = /^%var\.player\/([^ %]+)( [^%]+)?%$/;
const PLACEHOLDER_GLOBAL_VAR_REGEX = /^%var\.global\/([^ %]+)( [^%]+)?%$/;
const PLACEHOLDER_TEAM_VAR_REGEX = /^%var\.team\/([^ %]+)( [^ %]+)( [^%]+)?%$/;

export type PlaceholderBuiltin = { type: "BUILTIN" } & {
    [K in keyof typeof BUILTIN_PLACEHOLDERS]: {
        value: K;
        returnType: (typeof BUILTIN_PLACEHOLDERS)[K];
    };
}[keyof typeof BUILTIN_PLACEHOLDERS];

export type PlaceholderChangeVar = {
    type: "CHANGE_VAR";
    holder: VarHolder;
    key: VarName;
    fallback?: Value;
};

// TODO random placeholders, just same type as PlaceholderBuiltin
export type Placeholder = PlaceholderBuiltin | PlaceholderChangeVar;

export function tryIntoPlaceholder(value: string): Placeholder | null {
    if (value in BUILTIN_PLACEHOLDERS) {
        return {
            type: "BUILTIN",
            value: value,
            returnType: BUILTIN_PLACEHOLDERS[value],
        } as PlaceholderBuiltin;
    }

    const playerMatch = PLACEHOLDER_PLAYER_VAR_REGEX.exec(value);
    if (playerMatch) {
        return {
            type: "CHANGE_VAR",
            holder: { type: "player" },
            key: playerMatch[1],
            fallback: playerMatch[2],
        };
    }

    const globalMatch = PLACEHOLDER_GLOBAL_VAR_REGEX.exec(value);
    if (globalMatch) {
        return {
            type: "CHANGE_VAR",
            holder: { type: "global" },
            key: globalMatch[1],
            fallback: globalMatch[2],
        };
    }

    const teamMatch = PLACEHOLDER_TEAM_VAR_REGEX.exec(value);
    if (teamMatch) {
        return {
            type: "CHANGE_VAR",
            holder: { type: "team", team: teamMatch[2] },
            key: teamMatch[1],
            fallback: teamMatch[3],
        };
    }

    return null;
}
