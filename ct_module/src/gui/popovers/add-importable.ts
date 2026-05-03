/// <reference types="../../../CTAutocomplete" />

import { Element, Rect } from "../lib/layout";
import { Button, Col, Input, Row, Text } from "../lib/components";
import { closeAllPopovers, openPopover } from "../lib/popovers";
import { upsertImportableEntry } from "../../exporter/importJsonWriter";
import { getImportJsonPath } from "../state";
import { scheduleReparse } from "../state/reparse";

type AddType = "FUNCTION" | "EVENT" | "REGION" | "ITEM" | "MENU";

const TYPE_CYCLE: AddType[] = ["FUNCTION", "EVENT", "REGION", "ITEM", "MENU"];

let addType: AddType = "FUNCTION";
let addName = "";

function nextType(): void {
    const idx = TYPE_CYCLE.indexOf(addType);
    addType = TYPE_CYCLE[(idx + 1) % TYPE_CYCLE.length];
}

function sectionOf(type: AddType): "functions" | "events" | "regions" | "items" | "menus" {
    if (type === "FUNCTION") return "functions";
    if (type === "EVENT") return "events";
    if (type === "REGION") return "regions";
    if (type === "ITEM") return "items";
    return "menus";
}

function importJsonDir(): string {
    const path = getImportJsonPath();
    const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    if (slash < 0) return ".";
    return path.substring(0, slash);
}

function buildEntry(type: AddType, name: string): Record<string, unknown> {
    const dir = importJsonDir();
    if (type === "FUNCTION") {
        const htslPath = `${name}.htsl`;
        const fullHtslPath = `${dir}/${htslPath}`;
        if (!FileLib.exists(fullHtslPath)) FileLib.write(fullHtslPath, "", true);
        return { name, actions: htslPath };
    }
    if (type === "EVENT") {
        const htslPath = `${name}.htsl`;
        const fullHtslPath = `${dir}/${htslPath}`;
        if (!FileLib.exists(fullHtslPath)) FileLib.write(fullHtslPath, "", true);
        return { event: "Player Join", actions: htslPath };
    }
    if (type === "REGION") {
        return {
            name,
            bounds: { from: { x: 0, y: 0, z: 0 }, to: { x: 1, y: 1, z: 1 } },
        };
    }
    if (type === "ITEM") {
        const snbtPath = `${name}.snbt`;
        const fullSnbtPath = `${dir}/${snbtPath}`;
        if (!FileLib.exists(fullSnbtPath)) {
            FileLib.write(fullSnbtPath, '{ id: "minecraft:stone", Count: 1b }\n', true);
        }
        return { name, nbt: snbtPath };
    }
    return { name, slots: [] };
}

function submit(): void {
    if (addName.trim() === "") {
        ChatLib.chat("&c[htsw] Name cannot be empty");
        return;
    }
    try {
        const entry = buildEntry(addType, addName);
        upsertImportableEntry(getImportJsonPath(), sectionOf(addType), entry);
        ChatLib.chat(`&a[htsw] Added ${addType} ${addName}`);
        addName = "";
        closeAllPopovers();
        scheduleReparse();
    } catch (err) {
        const msg = err && (err as any).message ? (err as any).message : String(err);
        ChatLib.chat(`&c[htsw] Add failed: ${msg}`);
    }
}

function popoverContent(): Element {
    return Col({
        style: { padding: 6, gap: 4 },
        children: [
            Text({
                text: "Add Importable",
                style: { width: { kind: "grow" } },
            }),
            Row({
                style: { gap: 4 },
                children: [
                    Text({
                        text: "Type:",
                        style: { width: { kind: "px", value: 32 } },
                    }),
                    Button({
                        text: () => addType,
                        style: { width: { kind: "grow" } },
                        onClick: () => nextType(),
                    }),
                ],
            }),
            Row({
                style: { gap: 4 },
                children: [
                    Text({
                        text: "Name:",
                        style: { width: { kind: "px", value: 32 } },
                    }),
                    Input({
                        id: "add-importable-name",
                        value: () => addName,
                        onChange: (v) => { addName = v; },
                        placeholder: "name…",
                        style: { width: { kind: "grow" } },
                    }),
                ],
            }),
            Button({
                text: "Add",
                style: { width: { kind: "grow" } },
                onClick: () => submit(),
            }),
        ],
    });
}

export function openAddImportablePopover(anchor: Rect): void {
    openPopover({
        anchor,
        content: popoverContent(),
        width: 200,
        height: 80,
        key: "add-importable",
    });
}
