/// <reference types="../../../../../CTAutocomplete" />

import type { Importable } from "htsw/types";

import { getExportImportJsonPath, getHousingUuid } from "../../../state";
import { showToast } from "../../../toast";
import { getParseAt } from "../../../parsing/parses";
import type { ReadFn } from "../../../../importables/read";
import { startDeepRead } from "../../../knowledge/deepRead";

// Builds a `deepRead(onlyNames?)` for one content type: the export driver in
// read-only mode, caching live house contents instead of writing files.
// `onlyNames` limits the pass to a selection; omitted reads the whole house.
export function makeDeepRead(
    type: Importable["type"],
    label: string,
    read: ReadFn,
    isScanning: () => boolean
): (onlyNames?: string[]) => void {
    return (onlyNames?: string[]): void => {
        if (isScanning()) return;
        const uuid = getHousingUuid();
        if (uuid === null) return;
        const importJsonPath = getExportImportJsonPath();
        if (importJsonPath.trim() === "") {
            showToast("No import.json loaded — pick a destination first", 0xffe85c5c);
            return;
        }
        startDeepRead([{ type, label, read, names: onlyNames }], {
            housingUuid: uuid,
            importJsonPath,
            parsed: getParseAt(importJsonPath)?.parsed,
        });
    };
}
