import type { Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import { ensureFunctionNamesExist } from "./functions/shared";
import { ensureMenuNamesExist } from "./menus/shared";
import { ensureRegionNamesExist } from "./regions/shared";
import { collectReferencedImportables } from "./referenceScanner";

type RefShellKind = "function" | "menu" | "region";

export type OnRefShellCreated = (kind: RefShellKind, name: string) => void;

export async function createMissingReferencedShells(
    ctx: TaskContext,
    importable: Importable,
    onShellCreated?: OnRefShellCreated
): Promise<void> {
    const refs = collectReferencedImportables(importable);
    if (refs.functions.length > 0) {
        await ensureFunctionNamesExist(ctx, refs.functions, (name) =>
            onShellCreated?.("function", name)
        );
    }
    if (refs.menus.length > 0) {
        await ensureMenuNamesExist(ctx, refs.menus, (name) =>
            onShellCreated?.("menu", name)
        );
    }
    if (refs.regions.length > 0) {
        await ensureRegionNamesExist(ctx, refs.regions, (name) =>
            onShellCreated?.("region", name)
        );
    }
}
