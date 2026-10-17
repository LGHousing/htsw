/// <reference types="../../../../CTAutocomplete" />

import type { Importable } from "htsw/types";
import { renameImportableEntry, type Section } from "../../../project/importJsonMutations";
import { importableIdentity } from "../../../importables/identity";
import { closeAllPopovers } from "../../lib/popovers";
import { markParseStale, requestParse } from "../../parsing/parses";
import { openTextPromptPopover } from "../../popovers/text-prompt";
import { SECTION_BY_TYPE, bumpTreeRevision } from "./rowModel";

// False when the rename failed and the prompt should reopen.
function renameImportable(
    jsonPath: string,
    section: Section,
    imp: Importable,
    oldName: string,
    name: string
): boolean {
    if (name === oldName) return true;
    let renamed: boolean;
    try {
        renamed = renameImportableEntry(jsonPath, section, importableIdentity(imp), name);
    } catch (err) {
        ChatLib.chat(`&c[htsw] Rename failed: ${String(err)}`);
        return false;
    }
    if (!renamed) {
        ChatLib.chat(`&c[htsw] Rename failed: couldn't find ${oldName} in ${section}`);
        return false;
    }
    ChatLib.chat(`&a[htsw] Renamed ${oldName} → ${name}`);
    markParseStale(jsonPath);
    requestParse(jsonPath);
    bumpTreeRevision();
    closeAllPopovers();
    return true;
}

export function openRenameImportablePopover(
    jsonPath: string,
    imp: Importable,
    prefill?: string
): void {
    if (imp.type === "EVENT") {
        // Events are identified by their event constant, not by a free-text
        // name. Renaming one is changing the event, which is almost never what
        // the user means here.
        ChatLib.chat("&c[htsw] EVENTs aren't renameable from here — edit the event constant directly.");
        return;
    }
    const section = SECTION_BY_TYPE[imp.type];
    if (section === undefined) {
        ChatLib.chat(`&c[htsw] Rename not supported for ${imp.type}.`);
        return;
    }
    const oldName = imp.name;
    openTextPromptPopover({
        title: `Rename ${imp.type.toLowerCase()}`,
        placeholder: "new name…",
        prefill: prefill ?? oldName,
        submitLabel: "Save",
        onEmptySubmit: () => ChatLib.chat("&c[htsw] Name can't be empty."),
        onSubmit: (name) => {
            if (!renameImportable(jsonPath, section, imp, oldName, name)) {
                openRenameImportablePopover(jsonPath, imp, name);
            }
        },
    });
}
