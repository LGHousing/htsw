import type {
    ImportableCommand,
    ImportableFunction,
    ImportableRegion,
} from "htsw/types";

import { tryWriteImportableCache } from "../../importCache";
import type TaskContext from "../../tasks/context";
import type { ImportContext } from "./context";

export async function recordEmptyFunctionShell(
    ctx: TaskContext,
    session: ImportContext,
    name: string
): Promise<void> {
    const empty: ImportableFunction = { type: "FUNCTION", name, actions: [] };
    await tryWriteImportableCache(ctx, empty, "importer", session.housingUuid);
}

export async function recordEmptyCommandShell(
    ctx: TaskContext,
    session: ImportContext,
    name: string
): Promise<void> {
    const empty: ImportableCommand = {
        type: "COMMAND",
        name,
        actions: [],
        mode: "Self",
        requiredPriority: 0,
        listed: true,
    };
    await tryWriteImportableCache(ctx, empty, "importer", session.housingUuid);
}

export async function recordEmptyRegionShell(
    ctx: TaskContext,
    session: ImportContext,
    region: ImportableRegion
): Promise<void> {
    await tryWriteImportableCache(
        ctx,
        {
            type: "REGION",
            name: region.name,
            bounds: region.bounds,
            onEnterActions: [],
            onExitActions: [],
        },
        "importer",
        session.housingUuid
    );
}
