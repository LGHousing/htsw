/// <reference types="../../../../CTAutocomplete" />

import { Element, Rect } from "../../lib/layout";
import { Button, Col, Input, Row, Text } from "../../lib/components";
import { closeAllPopovers, openPopover } from "../../lib/popovers";
import type { Importable } from "htsw/types";
import { renameImportableEntry, type Section } from "../../../project/importJsonMutations";
import { markParseStale, requestParse } from "../../parsing/parses";
import { bumpTreeRevision } from "./rowModel";
import { importableIdentity } from "../../../importables/identity";

let editingValue = "";
let editingFor: string = "";

function sectionForType(type: Importable["type"]): Section | null {
    switch (type) {
        case "FUNCTION":
            return "functions";
        case "EVENT":
            return "events";
        case "REGION":
            return "regions";
        case "ITEM":
            return "items";
        case "MENU":
            return "menus";
        case "TEAM":
            return "teams";
        case "GROUP":
            return "groups";
        case "COMMAND":
            return "commands";
        case "NPC":
            return "npcs";
        default:
            return null;
    }
}

function entryIdentity(imp: Importable): string {
    return importableIdentity(imp);
}

function currentValue(imp: Importable): string {
    return imp.type === "EVENT" ? imp.event : imp.name;
}

function syncFor(imp: Importable): void {
    const id = `${imp.type}:${entryIdentity(imp)}`;
    if (editingFor !== id) {
        editingFor = id;
        editingValue = currentValue(imp);
    }
}

function save(jsonPath: string, imp: Importable): void {
    const trimmed = editingValue.trim();
    if (trimmed.length === 0) {
        ChatLib.chat("&c[htsw] Name can't be empty.");
        return;
    }
    if (trimmed === currentValue(imp)) {
        // No-op rename — still close the popover.
        editingFor = "";
        editingValue = "";
        closeAllPopovers();
        return;
    }
    const section = sectionForType(imp.type);
    if (section === null) {
        ChatLib.chat(`&c[htsw] Rename not supported for ${imp.type}.`);
        return;
    }
    if (imp.type === "EVENT") {
        // Events are identified by their event constant, not by a free-
        // text name. Renaming an event is changing the event constant —
        // refuse to do it from here, since it's almost never what the
        // user means and the editor surface should handle it directly.
        ChatLib.chat("&c[htsw] EVENTs aren't renameable from here — edit the event constant directly.");
        return;
    }
    const oldValue = currentValue(imp);
    const ok = renameImportableEntry(jsonPath, section, entryIdentity(imp), trimmed);
    if (!ok) {
        ChatLib.chat(`&c[htsw] Rename failed: couldn't find ${oldValue} in ${section}`);
        return;
    }
    ChatLib.chat(`&a[htsw] Renamed ${oldValue} → ${trimmed}`);
    editingFor = "";
    editingValue = "";
    markParseStale(jsonPath);
    requestParse(jsonPath);
    bumpTreeRevision();
    closeAllPopovers();
}

function popoverContent(jsonPath: string, imp: Importable): Element {
    syncFor(imp);
    return Col({
        style: { padding: 6, gap: 4 },
        children: [
            Text({
                text: `Rename ${imp.type.toLowerCase()}`,
                style: { width: { kind: "grow" } },
            }),
            Input({
                id: "rename-importable-input",
                value: () => editingValue,
                onChange: (v) => {
                    editingValue = v;
                },
                onSubmit: () => save(jsonPath, imp),
                placeholder: "new name…",
                style: {
                    width: { kind: "grow" },
                    height: { kind: "px", value: 18 },
                },
            }),
            Row({
                style: {
                    width: { kind: "grow" },
                    height: { kind: "px", value: 18 },
                    gap: 4,
                },
                children: [
                    Button({
                        text: "Save",
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "px", value: 18 },
                        },
                        onClick: () => save(jsonPath, imp),
                    }),
                    Button({
                        text: "Cancel",
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "px", value: 18 },
                        },
                        onClick: () => {
                            editingFor = "";
                            editingValue = "";
                            closeAllPopovers();
                        },
                    }),
                ],
            }),
        ],
    });
}

export function openRenameImportablePopover(
    anchor: Rect,
    jsonPath: string,
    imp: Importable
): void {
    syncFor(imp);
    openPopover({
        anchor,
        content: popoverContent(jsonPath, imp),
        width: 240,
        height: 64,
        key: `rename:${imp.type}:${entryIdentity(imp)}`,
    });
}
