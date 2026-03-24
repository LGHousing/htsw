import "promise-polyfill/src/polyfill";
import "./injectLong";
import "./tasks/manager";

import type { Condition } from "htsw/types";

import { TaskManager } from "./tasks/manager";
import { readOpenCondition } from "./importer/conditions";

const CONDITION_TYPES = [
    "REQUIRE_GROUP",
    "COMPARE_VAR",
    "REQUIRE_PERMISSION",
    "IS_IN_REGION",
    "REQUIRE_ITEM",
    "IS_DOING_PARKOUR",
    "REQUIRE_POTION_EFFECT",
    "IS_SNEAKING",
    "IS_FLYING",
    "COMPARE_HEALTH",
    "COMPARE_MAX_HEALTH",
    "COMPARE_HUNGER",
    "REQUIRE_GAMEMODE",
    "COMPARE_PLACEHOLDER",
    "REQUIRE_TEAM",
    "COMPARE_DAMAGE",
] satisfies Condition["type"][];

function isConditionType(value: string): value is Condition["type"] {
    return (CONDITION_TYPES as readonly string[]).indexOf(value) !== -1;
}

register("command", (...args: string[]) => {
    const type = args[0];

    if (!type || !isConditionType(type)) {
        ChatLib.chat("&cUsage: /htswtestcondition <condition type>");
        ChatLib.chat(`&7Known types: ${CONDITION_TYPES.join(", ")}`);
        return;
    }

    TaskManager.run(async (ctx) => {
        const condition = await readOpenCondition(ctx, type);
        ChatLib.chat(`&aRead ${type}: &f${JSON.stringify(condition)}`);
    });
}).setName("htswtestcondition");
