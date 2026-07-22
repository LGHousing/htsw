import type { Pos } from "htsw/types";

import { getCurrentHousingUuid } from "../../importCache";
import { listCachedImportables } from "../../importCache/cache";
import type { NpcExportEntry } from "../../project/paths";
import type { ReadFn } from "../export/reader";
import { exportAllNpcs } from "./exportAll";

function parseNpcPos(identity: string): Pos {
    const parts = identity.split(",");
    return { x: Number(parts[0]), y: Number(parts[1]), z: Number(parts[2]) };
}

// NPCs are position-keyed, so the generic name-based export/deep-read path
// can't drive them directly. This adapter turns the selected rows' position
// identities (`x,y,z`) back into export entries — resolving each row's display
// name from the scan cache — and runs the position-keyed batch (`exportAllNpcs`
// matches by position and re-reads the live name anyway).
export const readNpcs: ReadFn = async (ctx, options) => {
    let entries: NpcExportEntry[] | undefined;
    if (options.names !== undefined) {
        const uuid =
            options.output.kind === "cache"
                ? options.output.housingUuid
                : await getCurrentHousingUuid(ctx);
        const labelByIdentity = new Map<string, string>();
        const known = listCachedImportables(uuid, "NPC");
        for (let i = 0; i < known.length; i++) {
            labelByIdentity.set(known[i].name, known[i].label ?? known[i].name);
        }
        entries = options.names.map((identity) => ({
            name: labelByIdentity.get(identity) ?? identity,
            pos: parseNpcPos(identity),
        }));
    }
    return exportAllNpcs(ctx, {
        importJsonPath: options.importJsonPath,
        newExportTargetImportJson: options.newExportTargetImportJson,
        rootDir: options.rootDir,
        projectItems: options.projectItems,
        entries,
        skipExisting: options.skipExisting,
        progress: options.progress,
        output: options.output,
    });
};
