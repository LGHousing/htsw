import { Diagnostic, SourceMap, parseImportablesResult } from "htsw";
import type { Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import { FileSystemFileLoader } from "../utils/files";
import {
    buildKnowledgeTrustPlan,
    importableIdentity,
    trustPlanKey,
} from "../knowledge";
import { printDiagnostic } from "../tui/diagnostics";
import { createItemRegistry } from "./itemRegistry";
import { importImportable } from "./imports";

export type ImportSelection = {
    importables: Importable[];
    trustMode: boolean;
    housingUuid: string;
    sourcePath: string;
};

export type ImportSessionResult = {
    imported: number;
    skippedTrusted: number;
    failed: number;
};

export async function importSelectedImportables(
    ctx: TaskContext,
    selection: ImportSelection
): Promise<ImportSessionResult> {
    const sm = new SourceMap(new FileSystemFileLoader());
    const parsed = parseImportablesResult(sm, selection.sourcePath);
    const registry = createItemRegistry(parsed.value, parsed.gcx);
    const selectedKeys = new Set(
        selection.importables.map((importable) =>
            trustPlanKey(importable.type, importableIdentity(importable))
        )
    );
    const ordered = [
        ...parsed.value.filter((i) => i.type === "ITEM"),
        ...parsed.value.filter((i) => i.type !== "ITEM"),
    ].filter((importable) =>
        selectedKeys.has(trustPlanKey(importable.type, importableIdentity(importable)))
    );
    const trustPlan = selection.trustMode
        ? buildKnowledgeTrustPlan(selection.housingUuid, parsed.value)
        : undefined;

    const result: ImportSessionResult = {
        imported: 0,
        skippedTrusted: 0,
        failed: 0,
    };

    for (const importable of ordered) {
        const key = trustPlanKey(importable.type, importableIdentity(importable));
        const plan = trustPlan?.importables.get(key);
        if (plan?.wholeImportableTrusted) {
            result.skippedTrusted++;
        }

        try {
            await importImportable(ctx, importable, registry, { plan });
            if (!plan?.wholeImportableTrusted) {
                result.imported++;
            }
        } catch (error) {
            result.failed++;
            if (error instanceof Diagnostic) {
                printDiagnostic(sm, error);
            } else {
                ctx.displayMessage(`&cFailed to import ${importable.type}: ${error}`);
            }
        }
    }

    return result;
}
