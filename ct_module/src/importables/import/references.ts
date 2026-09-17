import type { Importable } from "htsw/types";

import TaskContext from "../../tasks/context";
import { ensureFunctionNamesExist } from "../functions/housing";
import { ensureMenuNamesExist } from "../menus/housing";
import { ensureRegionNamesExist } from "../regions/housing";
import { collectReferencedImportables } from "./referenceScanner";
import { getSessionFunctionNamesLower } from "../functions/listFunctions";
import { getSessionMenuNamesLower } from "../menus/listMenus";
import { listAllRegionNames } from "../regions/listRegions";
import { COST } from "../../housingSync/progress/costs";

type RefShellKind = "function" | "menu" | "region";

export type OnRefShellResolved = (
    kind: RefShellKind,
    name: string,
    created: boolean
) => void | Promise<void>;

export type ReferencedShellPlan = {
    functions: string[];
    menus: string[];
    regions: string[];
};

// `/pos1` and `/pos2` go out bare and back to back, so each sleeps out the
// 300ms command cooldown with no timed wait around it.
const BARE_COMMAND_UNITS = 1.2;

export function referencedShellApplicationUnits(kind: RefShellKind): number {
    if (kind === "function") {
        return (
            COST.commandMenuWait +
            COST.goBackWait +
            COST.cacheWrite
        );
    }
    if (kind === "menu") {
        return COST.commandMenuWait + COST.goBackWait;
    }
    return COST.commandMessageWait * 2 + BARE_COMMAND_UNITS * 2;
}

export function referencedShellPlanApplicationUnits(plan: ReferencedShellPlan): number {
    return (
        plan.functions.length * referencedShellApplicationUnits("function") +
        plan.menus.length * referencedShellApplicationUnits("menu") +
        plan.regions.length * referencedShellApplicationUnits("region")
    );
}

export async function planMissingReferencedShells(
    ctx: TaskContext,
    importables: readonly Importable[]
): Promise<ReferencedShellPlan> {
    const functions = new Map<string, string>();
    const menus = new Map<string, string>();
    const regions = new Map<string, string>();
    for (const importable of importables) {
        const refs = collectReferencedImportables(importable);
        addReferencedNames(functions, refs.functions);
        addReferencedNames(menus, refs.menus);
        addReferencedNames(regions, refs.regions);
    }

    const existingFunctions =
        functions.size === 0
            ? new Set<string>()
            : await getSessionFunctionNamesLower(ctx);
    const existingMenus =
        menus.size === 0 ? new Set<string>() : await getSessionMenuNamesLower(ctx);
    const existingRegions =
        regions.size === 0
            ? new Set<string>()
            : new Set((await listAllRegionNames(ctx)).map((name) => name.toLowerCase()));
    return {
        functions: Array.from(functions.values()).filter(
            (name) => !existingFunctions.has(name.toLowerCase())
        ),
        menus: Array.from(menus.values()).filter(
            (name) => !existingMenus.has(name.toLowerCase())
        ),
        regions: Array.from(regions.values()).filter(
            (name) => !existingRegions.has(name.toLowerCase())
        ),
    };
}

function addReferencedNames(
    names: Map<string, string>,
    referenced: readonly string[]
): void {
    for (const name of referenced) {
        const key = name.toLowerCase();
        if (!names.has(key)) names.set(key, name);
    }
}
export async function applyReferencedShellPlan(
    ctx: TaskContext,
    plan: ReferencedShellPlan,
    onShellResolved?: OnRefShellResolved
): Promise<void> {
    await resolveReferencedShells(
        plan.functions,
        "function",
        (onCreated) => ensureFunctionNamesExist(ctx, plan.functions, onCreated),
        onShellResolved
    );
    await resolveReferencedShells(
        plan.menus,
        "menu",
        (onCreated) => ensureMenuNamesExist(ctx, plan.menus, onCreated),
        onShellResolved
    );
    await resolveReferencedShells(
        plan.regions,
        "region",
        (onCreated) => ensureRegionNamesExist(ctx, plan.regions, onCreated),
        onShellResolved
    );
}

async function resolveReferencedShells(
    names: readonly string[],
    kind: RefShellKind,
    ensure: (onCreated: (name: string) => void | Promise<void>) => Promise<void>,
    onResolved: OnRefShellResolved | undefined
): Promise<void> {
    const created = new Set<string>();
    await ensure((name) => {
        created.add(name.toLowerCase());
    });
    for (const name of names) {
        await onResolved?.(kind, name, created.has(name.toLowerCase()));
    }
}
