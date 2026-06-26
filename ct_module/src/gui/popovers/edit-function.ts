/// <reference types="../../../CTAutocomplete" />

import type { Bounds, Importable, Pos } from "htsw/types";
import { MINECRAFT_ITEMS } from "htsw/types";

import { Element, Rect } from "../lib/layout";
import { Button, Col, Container, Input, Row, Scroll, Text } from "../lib/components";
import { closeAllPopovers, openPopover } from "../lib/popovers";
import { COLOR_ROW, COLOR_ROW_HOVER, COLOR_TEXT_DIM } from "../lib/theme";
import { updateImportableField, type Section } from "../../project/importJsonMutations";
import { markPathInSync } from "../parsing/reparse";
import { getParseAt, touchParseCacheMtime } from "../parsing/parses";
import { importableHash } from "../../importCache/hash";
import { seedImportableHash } from "../../importCache/status";

let editingValue = "";
let editingX = "";
let editingY = "";
let editingZ = "";
let editingFromX = "";
let editingFromY = "";
let editingFromZ = "";
let editingToX = "";
let editingToY = "";
let editingToZ = "";
let editingFor = "";

const MAX_SUGGESTIONS = 6;

function sectionForType(type: Importable["type"]): Section | null {
    switch (type) {
        case "FUNCTION": return "functions";
        case "EVENT": return "events";
        case "REGION": return "regions";
        case "ITEM": return "items";
        case "MENU": return "menus";
        case "TEAM": return "teams";
        case "GROUP": return "groups";
    }
    return null;
}

const SECTION_TYPE: Partial<{ [k in Section]: Importable["type"] }> = {
    functions: "FUNCTION", events: "EVENT", regions: "REGION",
    items: "ITEM", menus: "MENU", teams: "TEAM", groups: "GROUP",
};

function findImportableInList(
    list: readonly Importable[],
    section: Section,
    identity: string
): Importable | null {
    const type = SECTION_TYPE[section];
    if (type === undefined) return null;
    for (let i = 0; i < list.length; i++) {
        const imp = list[i];
        if (imp.type !== type) continue;
        const id = imp.type === "EVENT" ? imp.event : imp.name;
        if (id === identity) return imp;
    }
    return null;
}

function setByPath(obj: object, field: string | string[], value: unknown): void {
    const parts = typeof field === "string" ? [field] : field;
    let cur = obj as unknown as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        const next = cur[key];
        if (next === undefined || next === null) {
            if (value === undefined) return;
            const made: Record<string, unknown> = {};
            cur[key] = made;
            cur = made;
        } else if (typeof next === "object") {
            cur = next as Record<string, unknown>;
        } else {
            return;
        }
    }
    const lastKey = parts[parts.length - 1];
    if (value === undefined) delete cur[lastKey];
    else cur[lastKey] = value;
}

function identityOf(imp: Importable): string {
    return imp.type === "EVENT" ? imp.event : imp.name;
}

function matchingItems(query: string): string[] {
    if (query.length === 0) return [];
    let q = query.toLowerCase();
    if (q.indexOf("minecraft:") === 0) q = q.substring(10);
    if (q.length === 0) return [];
    const out: string[] = [];
    for (let i = 0; i < MINECRAFT_ITEMS.length && out.length < MAX_SUGGESTIONS; i++) {
        const item = MINECRAFT_ITEMS[i];
        if (item.name.indexOf(q) >= 0 || item.displayName.toLowerCase().indexOf(q) >= 0) {
            out.push("minecraft:" + item.name);
        }
    }
    return out;
}

function clearState(): void {
    editingFor = "";
    editingValue = "";
    editingX = "";
    editingY = "";
    editingZ = "";
    editingFromX = "";
    editingFromY = "";
    editingFromZ = "";
    editingToX = "";
    editingToY = "";
    editingToZ = "";
}

function currentBlockPos(): Pos {
    return {
        x: Math.floor(Player.getX()),
        y: Math.floor(Player.getY()),
        z: Math.floor(Player.getZ()),
    };
}

function optionalBounds(imp: Importable): Bounds | undefined {
    return imp.type === "REGION" ? (imp.bounds as Bounds | undefined) : undefined;
}

function setSingleCoordinateFields(pos: Pos): void {
    editingX = String(pos.x);
    editingY = String(pos.y);
    editingZ = String(pos.z);
}

function setBoundsFields(bounds: Bounds): void {
    editingFromX = String(bounds.from.x);
    editingFromY = String(bounds.from.y);
    editingFromZ = String(bounds.from.z);
    editingToX = String(bounds.to.x);
    editingToY = String(bounds.to.y);
    editingToZ = String(bounds.to.z);
}

function parsePos(x: string, y: string, z: string): Pos | null {
    const parsedX = parseFloat(x.trim());
    const parsedY = parseFloat(y.trim());
    const parsedZ = parseFloat(z.trim());
    if (isNaN(parsedX) || isNaN(parsedY) || isNaN(parsedZ)) return null;
    return { x: parsedX, y: parsedY, z: parsedZ };
}

function saveField(jsonPath: string, imp: Importable, fieldKey: string): void {
    const section = sectionForType(imp.type);
    if (section === null) return;
    const identity = identityOf(imp);

    let value: unknown;
    let field: string | string[] = fieldKey;

    if (fieldKey === "repeatTicks") {
        const trimmed = editingValue.trim();
        if (trimmed === "" || trimmed === "off" || trimmed === "0") {
            value = undefined;
        } else {
            const n = parseInt(trimmed, 10);
            if (isNaN(n) || n < 4 || n > 18000) { ChatLib.chat("&c[htsw] Repeat ticks must be 4-18000."); return; }
            value = n;
        }
    } else if (fieldKey === "icon") {
        const trimmed = editingValue.trim();
        if (trimmed === "" || trimmed === "default") { value = undefined; }
        else { value = { item: trimmed }; }
    } else if (fieldKey === "iconCount") {
        field = ["icon", "count"];
        const trimmed = editingValue.trim();
        if (trimmed === "" || trimmed === "1") { value = undefined; }
        else {
            const n = parseInt(trimmed, 10);
            if (isNaN(n) || n < 1 || n > 64) { ChatLib.chat("&c[htsw] Invalid count (1-64)."); return; }
            value = n;
        }
    } else if (fieldKey === "bounds") {
        const from = parsePos(editingFromX, editingFromY, editingFromZ);
        const to = parsePos(editingToX, editingToY, editingToZ);
        if (from === null || to === null) { ChatLib.chat("&c[htsw] Invalid coordinates."); return; }
        value = { from, to };
    } else if (fieldKey === "boundsFrom" || fieldKey === "boundsTo") {
        const pos = parsePos(editingX, editingY, editingZ);
        if (pos === null) { ChatLib.chat("&c[htsw] Invalid coordinates."); return; }
        field = ["bounds", fieldKey === "boundsFrom" ? "from" : "to"];
        value = pos;
    } else if (fieldKey === "size") {
        const trimmed = editingValue.trim();
        if (trimmed === "" || trimmed === "default") { value = undefined; }
        else {
            const n = parseInt(trimmed, 10);
            if (isNaN(n) || n < 1 || n > 6) { ChatLib.chat("&c[htsw] Invalid size (1-6)."); return; }
            value = n;
        }
    } else {
        return;
    }

    const ok = updateImportableField(jsonPath, section, identity, field, value);
    if (!ok) { ChatLib.chat("&c[htsw] Failed to update " + fieldKey + "."); return; }

    // Mirror the same path/value change into the in-memory parse so the
    // GUI updates without paying for a full reparse. Both the on-disk
    // and in-memory representations are now consistent, so we tell the
    // mtime watcher + parse cache not to re-fire.
    const entry = getParseAt(jsonPath);
    if (entry !== null && entry.parsed !== null) {
        const imp = findImportableInList(entry.parsed.value, section, identity);
        if (imp !== null) {
            setByPath(imp, field, value);
            // The hash memo assumes a parse swaps action-list arrays on every
            // edit; this mutates one in place (same array ref), so reseed the
            // memo with the true new hash or the dot would read the old one.
            seedImportableHash(imp, importableHash(imp));
        }
    }
    touchParseCacheMtime(jsonPath);
    markPathInSync(jsonPath);

    clearState();
    closeAllPopovers();
}

function suggestionRow(item: string, jsonPath: string, imp: Importable): Element {
    return Container({
        style: {
            direction: "row",
            align: "center",
            padding: { side: "x", value: 4 },
            height: { kind: "px", value: 16 },
            background: COLOR_ROW,
            hoverBackground: COLOR_ROW_HOVER,
        },
        onClick: () => { editingValue = item; saveField(jsonPath, imp, "icon"); },
        children: [
            Text({ text: item, color: COLOR_TEXT_DIM, truncate: true, style: { width: { kind: "grow" } } }),
        ],
    });
}

function coordinateContent(jsonPath: string, imp: Importable, fieldKey: string, label: string): Element {
    return Col({
        style: { padding: 6, gap: 4 },
        children: [
            Text({ text: label, style: { width: { kind: "grow" } } }),
            Row({
                style: { width: { kind: "grow" }, height: { kind: "px", value: 18 }, gap: 4 },
                children: [
                    Input({
                        id: "edit-coord-x-" + fieldKey,
                        value: () => editingX,
                        onChange: (v) => { editingX = v; },
                        onSubmit: () => saveField(jsonPath, imp, fieldKey),
                        placeholder: "x",
                        style: { width: { kind: "grow" }, height: { kind: "grow" } },
                    }),
                    Input({
                        id: "edit-coord-y-" + fieldKey,
                        value: () => editingY,
                        onChange: (v) => { editingY = v; },
                        onSubmit: () => saveField(jsonPath, imp, fieldKey),
                        placeholder: "y",
                        style: { width: { kind: "grow" }, height: { kind: "grow" } },
                    }),
                    Input({
                        id: "edit-coord-z-" + fieldKey,
                        value: () => editingZ,
                        onChange: (v) => { editingZ = v; },
                        onSubmit: () => saveField(jsonPath, imp, fieldKey),
                        placeholder: "z",
                        style: { width: { kind: "grow" }, height: { kind: "grow" } },
                    }),
                ],
            }),
            Row({
                style: { width: { kind: "grow" }, height: { kind: "px", value: 18 }, gap: 4 },
                children: [
                    Button({
                        text: "Save",
                        style: { width: { kind: "grow" }, height: { kind: "px", value: 18 } },
                        onClick: () => saveField(jsonPath, imp, fieldKey),
                    }),
                    Button({
                        text: "Cancel",
                        style: { width: { kind: "grow" }, height: { kind: "px", value: 18 } },
                        onClick: () => closeAllPopovers(),
                    }),
                ],
            }),
        ],
    });
}

function boundsCoordinateRow(
    idPart: string,
    label: string,
    getX: () => string,
    setX: (v: string) => void,
    getY: () => string,
    setY: (v: string) => void,
    getZ: () => string,
    setZ: (v: string) => void,
    jsonPath: string,
    imp: Importable
): Element {
    return Row({
        style: { width: { kind: "grow" }, height: { kind: "px", value: 18 }, gap: 4 },
        children: [
            Text({ text: label, style: { width: { kind: "px", value: 34 } } }),
            Input({
                id: "edit-bounds-" + idPart + "-x",
                value: getX,
                onChange: setX,
                onSubmit: () => saveField(jsonPath, imp, "bounds"),
                placeholder: "x",
                style: { width: { kind: "grow" }, height: { kind: "grow" } },
            }),
            Input({
                id: "edit-bounds-" + idPart + "-y",
                value: getY,
                onChange: setY,
                onSubmit: () => saveField(jsonPath, imp, "bounds"),
                placeholder: "y",
                style: { width: { kind: "grow" }, height: { kind: "grow" } },
            }),
            Input({
                id: "edit-bounds-" + idPart + "-z",
                value: getZ,
                onChange: setZ,
                onSubmit: () => saveField(jsonPath, imp, "bounds"),
                placeholder: "z",
                style: { width: { kind: "grow" }, height: { kind: "grow" } },
            }),
        ],
    });
}

function boundsContent(jsonPath: string, imp: Importable): Element {
    return Col({
        style: { padding: 6, gap: 4 },
        children: [
            Text({ text: "Bounds", style: { width: { kind: "grow" } } }),
            boundsCoordinateRow(
                "from",
                "From",
                () => editingFromX,
                (v) => { editingFromX = v; },
                () => editingFromY,
                (v) => { editingFromY = v; },
                () => editingFromZ,
                (v) => { editingFromZ = v; },
                jsonPath,
                imp
            ),
            boundsCoordinateRow(
                "to",
                "To",
                () => editingToX,
                (v) => { editingToX = v; },
                () => editingToY,
                (v) => { editingToY = v; },
                () => editingToZ,
                (v) => { editingToZ = v; },
                jsonPath,
                imp
            ),
            Row({
                style: { width: { kind: "grow" }, height: { kind: "px", value: 18 }, gap: 4 },
                children: [
                    Button({
                        text: "Save",
                        style: { width: { kind: "grow" }, height: { kind: "px", value: 18 } },
                        onClick: () => saveField(jsonPath, imp, "bounds"),
                    }),
                    Button({
                        text: "Cancel",
                        style: { width: { kind: "grow" }, height: { kind: "px", value: 18 } },
                        onClick: () => closeAllPopovers(),
                    }),
                ],
            }),
        ],
    });
}

function singleFieldContent(jsonPath: string, imp: Importable, fieldKey: string, label: string, placeholder: string): Element {
    return Col({
        style: { padding: 6, gap: 4 },
        children: [
            Text({ text: label, style: { width: { kind: "grow" } } }),
            Input({
                id: "edit-field-" + fieldKey,
                value: () => editingValue,
                onChange: (v) => { editingValue = v; },
                onSubmit: () => saveField(jsonPath, imp, fieldKey),
                placeholder,
                style: { width: { kind: "grow" }, height: { kind: "px", value: 18 } },
            }),
            Row({
                style: { width: { kind: "grow" }, height: { kind: "px", value: 18 }, gap: 4 },
                children: [
                    Button({
                        text: "Save",
                        style: { width: { kind: "grow" }, height: { kind: "px", value: 18 } },
                        onClick: () => saveField(jsonPath, imp, fieldKey),
                    }),
                    Button({
                        text: "Clear",
                        style: { width: { kind: "grow" }, height: { kind: "px", value: 18 } },
                        onClick: () => { editingValue = ""; saveField(jsonPath, imp, fieldKey); },
                    }),
                ],
            }),
        ],
    });
}

function iconFieldContent(jsonPath: string, imp: Importable): Element {
    return Col({
        style: { padding: 6, gap: 4 },
        children: [
            Text({ text: "Icon item", style: { width: { kind: "grow" } } }),
            Input({
                id: "edit-field-icon",
                value: () => editingValue,
                onChange: (v) => { editingValue = v; },
                onSubmit: () => saveField(jsonPath, imp, "icon"),
                placeholder: "item id",
                style: { width: { kind: "grow" }, height: { kind: "px", value: 18 } },
            }),
            Scroll({
                id: "edit-fn-icon-suggestions",
                style: { gap: 1, height: { kind: "grow" } },
                children: () => {
                    const matches = matchingItems(editingValue);
                    return matches.map((m) => suggestionRow(m, jsonPath, imp));
                },
            }),
            Row({
                style: { width: { kind: "grow" }, height: { kind: "px", value: 18 }, gap: 4 },
                children: [
                    Button({
                        text: "Save",
                        style: { width: { kind: "grow" }, height: { kind: "px", value: 18 } },
                        onClick: () => saveField(jsonPath, imp, "icon"),
                    }),
                    Button({
                        text: "Clear",
                        style: { width: { kind: "grow" }, height: { kind: "px", value: 18 } },
                        onClick: () => { editingValue = ""; saveField(jsonPath, imp, "icon"); },
                    }),
                ],
            }),
        ],
    });
}

export function openEditFunctionFieldPopover(
    anchor: Rect,
    jsonPath: string,
    imp: Importable,
    fieldKey: string
): void {
    const identity = identityOf(imp);
    const id = imp.type + ":" + identity + ":" + fieldKey;

    if (editingFor !== id) {
        clearState();
        editingFor = id;

        if (imp.type === "FUNCTION") {
            if (fieldKey === "repeatTicks") {
                editingValue = imp.repeatTicks !== undefined ? String(imp.repeatTicks) : "";
            } else if (fieldKey === "icon") {
                editingValue = imp.icon !== undefined ? imp.icon.item : "";
            } else if (fieldKey === "iconCount") {
                editingValue = imp.icon !== undefined && imp.icon.count !== undefined
                    ? String(imp.icon.count) : "";
            }
        } else if (imp.type === "REGION") {
            const current = currentBlockPos();
            const bounds = optionalBounds(imp);
            if (fieldKey === "bounds") {
                setBoundsFields(bounds ?? { from: current, to: current });
            } else if (fieldKey === "boundsFrom") {
                setSingleCoordinateFields(bounds !== undefined ? bounds.from : current);
            } else if (fieldKey === "boundsTo") {
                setSingleCoordinateFields(bounds !== undefined ? bounds.to : current);
            }
        } else if (imp.type === "MENU") {
            if (fieldKey === "size") {
                editingValue = imp.size !== undefined ? String(imp.size) : "";
            }
        }
    }

    let content: Element;
    let width = 220;
    let height = 64;

    if (fieldKey === "icon") {
        content = iconFieldContent(jsonPath, imp);
        height = 160;
    } else if (fieldKey === "bounds") {
        content = boundsContent(jsonPath, imp);
        width = 280;
        height = 88;
    } else if (fieldKey === "boundsFrom") {
        content = coordinateContent(jsonPath, imp, fieldKey, "Bounds from");
        width = 260;
    } else if (fieldKey === "boundsTo") {
        content = coordinateContent(jsonPath, imp, fieldKey, "Bounds to");
        width = 260;
    } else if (fieldKey === "repeatTicks") {
        content = singleFieldContent(jsonPath, imp, fieldKey, "Repeat ticks", "4-18000 (0 = off)");
    } else if (fieldKey === "iconCount") {
        content = singleFieldContent(jsonPath, imp, fieldKey, "Icon count", "count (1-64)");
    } else if (fieldKey === "size") {
        content = singleFieldContent(jsonPath, imp, fieldKey, "Menu size", "lines (1-6)");
    } else {
        return;
    }

    openPopover({
        anchor,
        content,
        width,
        height,
        key: "edit-field:" + id,
    });
}
