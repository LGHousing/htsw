/// <reference types="../../../CTAutocomplete" />

import { boundImportJsonPath } from "../../importCache/houseBindings";
import { setExportImportJsonPath } from "./paths";
import { markGuiDirty } from "../lib/dirty";
import {
    asNullableString,
    defineDoc,
    defineValue,
} from "../../persistence/store";

// Persisted across /ct reload: the in-memory uuid being wiped left every
// house-derived UI (bind chips, bound markers, house names) in its gray
// "unknown house" state for the ~1s until the /wtfmap auto-fetch landed.
// Restoring the last-known uuid is safe under the existing staleness model:
// the "Sending you to…" transport handler nulls it on any server change,
// and that null is persisted too, so a reload in a lobby doesn't resurrect
// a house you already left.
const HOUSING = defineDoc({
    file: "housing.json",
    legacyPaths: ["./config/ChatTriggers/modules/HTSW/gui-housing.json"],
    onReadError: "defaults",
});

const storedUuid = defineValue<string | null>(HOUSING, {
    key: "uuid",
    fallback: null,
    parse: (raw, fallback) => {
        const value = asNullableString(raw, fallback);
        // An empty string is not a house; treat it as "no uuid".
        return value === null || value.length === 0 ? null : value;
    },
});

export function getHousingUuid(): string | null {
    return storedUuid.get();
}
export function setHousingUuid(uuid: string | null): void {
    const changed = uuid !== storedUuid.get();
    storedUuid.set(uuid);
    if (changed) markGuiDirty();
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
