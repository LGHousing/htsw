import {
    moveImportableEntry as moveImportableEntryWithFs,
    planDeleteImportableEntry as planDeleteImportableEntryWithFs,
    removeImportableEntryForDelete as removeImportableEntryForDeleteWithFs,
    renameImportableEntry as renameImportableEntryWithFs,
    setHouseUuidKey as setHouseUuidKeyWithFs,
    updateImportableField as updateImportableFieldWithFs,
    upsertImportableEntry as upsertImportableEntryWithFs,
    removeIncludeFromImportJson as removeIncludeFromImportJsonWithFs,
    type MoveImportableResult,
    type DeleteImportablePlan,
    type DeleteImportableResult,
    type Section,
} from "htsw-editor-common/project";
import { ctProjectFs } from "./projectFs";

export type {
    DeleteImportablePlan,
    DeleteImportableResult,
    MoveImportableResult,
    Section,
};

export function upsertImportableEntry(
    importJsonPath: string,
    section: Section,
    entry: Record<string, unknown>
): void {
    upsertImportableEntryWithFs(ctProjectFs, importJsonPath, section, entry);
}

export function setHouseUuidKey(
    importJsonPath: string,
    houseUuid: string | null
): boolean {
    return setHouseUuidKeyWithFs(ctProjectFs, importJsonPath, houseUuid);
}

export function updateImportableField(
    entryJsonPath: string,
    section: Section,
    identity: string,
    field: string | string[],
    value: unknown
): boolean {
    return updateImportableFieldWithFs(
        ctProjectFs,
        entryJsonPath,
        section,
        identity,
        field,
        value
    );
}
export function planDeleteImportableEntry(
    entryJsonPath: string,
    section: Section,
    identity: string
): DeleteImportablePlan {
    return planDeleteImportableEntryWithFs(ctProjectFs, entryJsonPath, section, identity);
}

export function removeImportableEntryForDelete(
    entryJsonPath: string,
    section: Section,
    identity: string
): DeleteImportableResult {
    return removeImportableEntryForDeleteWithFs(
        ctProjectFs,
        entryJsonPath,
        section,
        identity
    );
}

export function removeIncludeFromImportJson(
    parentImportJsonPath: string,
    includedImportJsonPath: string
): boolean {
    return removeIncludeFromImportJsonWithFs(
        ctProjectFs,
        parentImportJsonPath,
        includedImportJsonPath
    );
}

export function renameImportableEntry(
    entryJsonPath: string,
    section: Section,
    oldIdentity: string,
    newIdentity: string
): boolean {
    return renameImportableEntryWithFs(
        ctProjectFs,
        entryJsonPath,
        section,
        oldIdentity,
        newIdentity
    );
}

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
