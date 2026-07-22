import type { Importable } from "htsw/types";

import TaskContext from "../../tasks/context";
import { ensureFunctionNamesExist } from "../functions/housing";
import { ensureMenuNamesExist } from "../menus/housing";
import { ensureRegionNamesExist } from "../regions/housing";
import { collectReferencedImportables } from "./referenceScanner";
import { getSessionFunctionNamesLower } from "../functions/listFunctions";
import { getSessionMenuNamesLower } from "../menus/listMenus";
import { listAllRegionNames } from "../regions/listRegions";

type RefShellKind = "function" | "menu" | "region";

export type OnRefShellCreated = (kind: RefShellKind, name: string) => void;

export type ReferencedShellPlan = {
    functions: string[];
    menus: string[];
    regions: string[];
};

export async function planMissingReferencedShells(
    ctx: TaskContext,
    importables: readonly Importable[]
): Promise<ReferencedShellPlan> {
    const functions = new Set<string>();
    const menus = new Set<string>();
    const regions = new Set<string>();
    for (const importable of importables) {
        const refs = collectReferencedImportables(importable);
        for (const name of refs.functions) functions.add(name);
        for (const name of refs.menus) menus.add(name);
        for (const name of refs.regions) regions.add(name);
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
            : new Set(
                  (await listAllRegionNames(ctx)).map((name) => name.toLowerCase())
              );
    return {
        functions: Array.from(functions).filter(
            (name) => !existingFunctions.has(name.toLowerCase())
        ),
        menus: Array.from(menus).filter(
            (name) => !existingMenus.has(name.toLowerCase())
        ),
        regions: Array.from(regions).filter(
            (name) => !existingRegions.has(name.toLowerCase())
        ),
    };
}
export async function applyReferencedShellPlan(
    ctx: TaskContext,
    plan: ReferencedShellPlan,
    onShellCreated?: OnRefShellCreated
): Promise<void> {
    await ensureFunctionNamesExist(ctx, plan.functions, (name) =>
        onShellCreated?.("function", name)
    );
    await ensureMenuNamesExist(ctx, plan.menus, (name) =>
        onShellCreated?.("menu", name)
    );
    await ensureRegionNamesExist(ctx, plan.regions, (name) =>
        onShellCreated?.("region", name)
    );
}
