import type { Condition } from "../../types";
import { COMPARISON_SYMBOLS } from "../parse/helpers";
import {
    printBoolean,
    printNumericalPlaceholder,
    printOption,
    printValue,
} from "./arguments";
import { quoteName } from "./helpers";

/**
 * Emits one condition's body — the leading `!` (when inverted) plus the
 * type-specific keyword/args. Does NOT emit the condition's note; that's
 * handled by the action-level printer because notes need to be placed on
 * their own line above the condition (the parser accepts `///` lines
 * between comma-separated conditions inside `if (...)`).
 */
export function printCondition(cond: Condition): string {
    const prefix = cond.inverted ? "!" : "";
    return prefix + printConditionBody(cond);
}

function printConditionBody(cond: Condition): string {
    switch (cond.type) {
        case "REQUIRE_GROUP": {
            const parts: string[] = ["hasGroup"];
            if (cond.group !== undefined) parts.push(quoteName(cond.group));
            if (cond.includeHigherGroups !== undefined)
                parts.push(printBoolean(cond.includeHigherGroups));
            return parts.join(" ");
        }
        case "COMPARE_VAR": {
            const holder = cond.holder ?? { type: "Player" };
            const kw =
                holder.type === "Global"
                    ? "globalvar"
                    : holder.type === "Team"
                        ? "teamvar"
                        : "var";
            const parts: string[] = [kw];
            if (cond.var !== undefined) parts.push(quoteName(cond.var));
            if (holder.type === "Team") {
                parts.push(quoteName(holder.team ?? ""));
            }
            if (cond.op !== undefined) parts.push(COMPARISON_SYMBOLS[cond.op]);
            if (cond.amount !== undefined) parts.push(printValue(cond.amount));
            if (cond.fallback !== undefined) parts.push(printValue(cond.fallback));
            return parts.join(" ");
        }
        case "REQUIRE_PERMISSION": {
            const parts: string[] = ["hasPermission"];
            if (cond.permission !== undefined) parts.push(printOption(cond.permission));
            return parts.join(" ");
        }
        case "IS_IN_REGION": {
            const parts: string[] = ["inRegion"];
            if (cond.region !== undefined) parts.push(quoteName(cond.region));
            return parts.join(" ");
        }
        case "REQUIRE_ITEM": {
            const parts: string[] = ["hasItem"];
            if (cond.itemName !== undefined) parts.push(quoteName(cond.itemName));
            if (cond.whatToCheck !== undefined) parts.push(printOption(cond.whatToCheck));
            if (cond.whereToCheck !== undefined) parts.push(printOption(cond.whereToCheck));
            if (cond.amount !== undefined) parts.push(printOption(cond.amount));
            return parts.join(" ");
        }
        case "IS_DOING_PARKOUR":
            return "doingParkour";
        case "REQUIRE_POTION_EFFECT": {
            const parts: string[] = ["hasPotion"];
            if (cond.effect !== undefined) parts.push(printOption(cond.effect));
            return parts.join(" ");
        }
        case "IS_SNEAKING":
            return "isSneaking";
        case "IS_FLYING":
            return "isFlying";
        case "COMPARE_HEALTH": {
            const parts: string[] = ["health"];
            if (cond.op !== undefined) parts.push(COMPARISON_SYMBOLS[cond.op]);
            if (cond.amount !== undefined) parts.push(printValue(cond.amount));
            return parts.join(" ");
        }
        case "COMPARE_MAX_HEALTH": {
            const parts: string[] = ["maxHealth"];
            if (cond.op !== undefined) parts.push(COMPARISON_SYMBOLS[cond.op]);
            if (cond.amount !== undefined) parts.push(printValue(cond.amount));
            return parts.join(" ");
        }
        case "COMPARE_HUNGER": {
            const parts: string[] = ["hunger"];
            if (cond.op !== undefined) parts.push(COMPARISON_SYMBOLS[cond.op]);
            if (cond.amount !== undefined) parts.push(printValue(cond.amount));
            return parts.join(" ");
        }
        case "REQUIRE_GAMEMODE": {
            const parts: string[] = ["gamemode"];
            if (cond.gamemode !== undefined) parts.push(printOption(cond.gamemode));
            return parts.join(" ");
        }
        case "COMPARE_PLACEHOLDER": {
            const parts: string[] = ["placeholder"];
            if (cond.placeholder !== undefined)
                parts.push(printNumericalPlaceholder(cond.placeholder));
            if (cond.op !== undefined) parts.push(COMPARISON_SYMBOLS[cond.op]);
            if (cond.amount !== undefined) parts.push(printValue(cond.amount));
            if (cond.fallback !== undefined) parts.push(printValue(cond.fallback));
            return parts.join(" ");
        }
        case "REQUIRE_TEAM": {
            const parts: string[] = ["hasTeam"];
            if (cond.team !== undefined) parts.push(quoteName(cond.team));
            return parts.join(" ");
        }
        case "DAMAGE_CAUSE": {
            const parts: string[] = ["damageCause"];
            if (cond.cause !== undefined) parts.push(printOption(cond.cause));
            return parts.join(" ");
        }
        case "PVP_ENABLED":
            return "canPvp";
        case "FISHING_ENVIRONMENT": {
            const parts: string[] = ["fishingEnv"];
            if (cond.environment !== undefined) parts.push(printOption(cond.environment));
            return parts.join(" ");
        }
        case "PORTAL_TYPE": {
            const parts: string[] = ["portal"];
            if (cond.portalType !== undefined) parts.push(printOption(cond.portalType));
            return parts.join(" ");
        }
        case "BLOCK_TYPE": {
            const parts: string[] = ["blockType"];
            if (cond.itemName !== undefined) parts.push(quoteName(cond.itemName));
            return parts.join(" ");
        }
        case "IS_ITEM": {
            const parts: string[] = ["isItem"];
            if (cond.itemName !== undefined) parts.push(quoteName(cond.itemName));
            return parts.join(" ");
        }
        case "COMPARE_DAMAGE": {
            const parts: string[] = ["damageAmount"];
            if (cond.op !== undefined) parts.push(COMPARISON_SYMBOLS[cond.op]);
            if (cond.amount !== undefined) parts.push(printValue(cond.amount));
            return parts.join(" ");
        }
        default: {
            const _exhaustive: never = cond;
            void _exhaustive;
            throw new Error(
                `printCondition: unhandled condition type ${(cond as { type: string }).type}`
            );
        }
    }
}
