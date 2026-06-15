import {
    moveImportableEntry as moveImportableEntryWithFs,
    type MoveImportableResult,
    type Section,
} from "htsw-project";
import { ctProjectFs } from "./projectFs";

export type { MoveImportableResult };

export function moveImportableEntry(
    entryJsonPath: string,
    section: Section,
    identity: string,
    destJsonPath: string
): MoveImportableResult {
    return moveImportableEntryWithFs(
        ctProjectFs,
        entryJsonPath,
        section,
        identity,
        destJsonPath
    );
}
