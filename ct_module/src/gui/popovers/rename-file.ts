/// <reference types="../../../CTAutocomplete" />

import { pathExists } from "../../utils/filesystem";
import { javaType } from "../../utils/java";
import { basename, dirname } from "../../project/pathDisplay";
import { openTextPromptPopover } from "./text-prompt";

// False when the rename failed and the prompt should reopen.
function renameFile(fullPath: string, name: string): boolean {
    if (name === basename(fullPath)) return true;
    const dir = dirname(fullPath);
    const target = dir.length === 0 ? name : `${dir}/${name}`;
    if (pathExists(target)) {
        ChatLib.chat(`&c[htsw] ${name} already exists.`);
        return false;
    }
    try {
        const Paths = javaType("java.nio.file.Paths");
        javaType("java.nio.file.Files").move(Paths.get(fullPath), Paths.get(target));
    } catch (err) {
        ChatLib.chat(`&c[htsw] Rename failed: ${String(err)}`);
        return false;
    }
    ChatLib.chat(`&a[htsw] Renamed → ${name}`);
    return true;
}

export function openRenameFilePopover(
    fullPath: string,
    prefill: string = basename(fullPath)
): void {
    openTextPromptPopover({
        title: `Rename ${basename(fullPath)}`,
        placeholder: "new filename…",
        prefill,
        submitLabel: "Save",
        onEmptySubmit: () => ChatLib.chat("&c[htsw] Name can't be empty."),
        onSubmit: (name) => {
            // Reopen with what was typed so a clash can be fixed in place.
            if (!renameFile(fullPath, name)) openRenameFilePopover(fullPath, name);
        },
    });
}
