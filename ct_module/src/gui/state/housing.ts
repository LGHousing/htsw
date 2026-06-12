/// <reference types="../../../CTAutocomplete" />

import { boundImportJsonPath } from "../../importCache/houseBindings";
import { setExportImportJsonPath } from "./paths";

let housingUuid: string | null = null;

export function getHousingUuid(): string | null {
    return housingUuid;
}
export function setHousingUuid(uuid: string | null): void {
    const changed = uuid !== housingUuid;
    housingUuid = uuid;
    // Entering a bound house points the export/compare destination at its
    // import.json, so the Houses tab and exporters line up without a manual
    // destination pick. Manual picks still win afterwards — this only fires
    // on the uuid transition.
    if (changed && uuid !== null) {
        const bound = boundImportJsonPath(uuid);
        if (bound !== null && FileLib.exists(bound)) {
            setExportImportJsonPath(bound);
        }
    }
}
