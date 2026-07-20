/// <reference types="../../../CTAutocomplete" />

import { boundImportJsonPath } from "../../importCache/houseBindings";
import { setExportImportJsonPath } from "./paths";
import { runtimeString, type RuntimeString } from "../lib/java";

// Persisted across /ct reload: the in-memory uuid being wiped left every
// house-derived UI (bind chips, bound markers, house names) in its gray
// "unknown house" state for the ~1s until the /wtfmap auto-fetch landed.
// Restoring the last-known uuid is safe under the existing staleness model:
// the "Sending you to…" transport handler nulls it on any server change,
// and that null is persisted too, so a reload in a lobby doesn't resurrect
// a house you already left.
const HOUSING_STATE_PATH = "./config/ChatTriggers/modules/HTSW/gui-housing.json";

let housingUuid: string | null = null;
let loaded = false;

function load(): void {
    if (loaded) return;
    loaded = true;
    try {
        if (!FileLib.exists(HOUSING_STATE_PATH)) return;
        const stored = FileLib.read(HOUSING_STATE_PATH) as RuntimeString | null | undefined;
        const raw = runtimeString(stored);
        if (raw.trim() === "") return;
        const parsed = JSON.parse(raw) as { uuid?: unknown };
        if (typeof parsed.uuid === "string" && parsed.uuid.length > 0) {
            housingUuid = parsed.uuid;
        }
    } catch (_e) {
        // fresh state on a bad file
    }
}

function persist(): void {
    try {
        FileLib.write(HOUSING_STATE_PATH, JSON.stringify({ uuid: housingUuid }), true);
    } catch (_e) {
        // best-effort
    }
}

export function getHousingUuid(): string | null {
    load();
    return housingUuid;
}
export function setHousingUuid(uuid: string | null): void {
    load();
    const changed = uuid !== housingUuid;
    housingUuid = uuid;
    persist();
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
