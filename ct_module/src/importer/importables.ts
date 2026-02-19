import {
    Importable,
    ImportableEvent,
    ImportableFunction,
    ImportableRegion,
} from "htsw/types";

import { Importer } from "./importer";
import { importAction } from "./actions";
import TaskContext from "../tasks/context";

export async function importImportable(
    ctx: TaskContext,
    importable: Importable
): Promise<void> {
    if (importable.type === "FUNCTION") {
        return importImportableFunction(ctx, importable);
    }
    if (importable.type === "EVENT") {
        return importImportableEvent(ctx, importable);
    }
    if (importable.type === "REGION") {
        return importImportableRegion(ctx, importable);
    }
    // TODO add the others idk and remove the ts ignore
    // @ts-ignore
    const _exhaustiveCheck: never = importable;
}

async function importImportableFunction(
    ctx: TaskContext,
    importable: ImportableFunction
): Promise<void> {}

async function importImportableEvent(
    ctx: TaskContext,
    importable: ImportableEvent
): Promise<void> {}

async function importImportableRegion(
    ctx: TaskContext,
    importable: ImportableRegion
): Promise<void> {}
