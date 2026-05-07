/// <reference types="../../../CTAutocomplete" />

import { Element, Rect } from "../lib/layout";
import { Button, Col, Input, Row, Text } from "../lib/components";
import { closePopover, openPopover, type PopoverHandle } from "../lib/popovers";

let editingValue = "";
let editingPath = "";
let onDoneCallback: (() => void) | null = null;
let activeHandle: PopoverHandle | null = null;

function closeSelf(): void {
    if (activeHandle !== null) {
        closePopover(activeHandle);
        activeHandle = null;
    }
}

function basename(p: string): string {
    const norm = p.replace(/\\/g, "/");
    const slash = norm.lastIndexOf("/");
    return slash < 0 ? norm : norm.substring(slash + 1);
}

function dirname(p: string): string {
    const norm = p.replace(/\\/g, "/");
    const slash = norm.lastIndexOf("/");
    return slash < 0 ? "" : norm.substring(0, slash);
}

function syncFor(fullPath: string): void {
    if (editingPath !== fullPath) {
        editingPath = fullPath;
        editingValue = basename(fullPath);
    }
}

function save(fullPath: string): void {
    const trimmed = editingValue.trim();
    if (trimmed.length === 0) {
        ChatLib.chat("&c[htsw] Name can't be empty.");
        return;
    }
    if (trimmed === basename(fullPath)) {
        editingPath = "";
        editingValue = "";
        closeSelf();
        return;
    }
    const dir = dirname(fullPath);
    const target = dir.length === 0 ? trimmed : `${dir}/${trimmed}`;
    try {
        // @ts-ignore
        const Paths = Java.type("java.nio.file.Paths");
        // @ts-ignore
        const Files = Java.type("java.nio.file.Files");
        const src = Paths.get(String(fullPath));
        const dst = Paths.get(String(target));
        if (Files.exists(dst)) {
            ChatLib.chat(`&c[htsw] ${trimmed} already exists.`);
            return;
        }
        Files.move(src, dst);
        ChatLib.chat(`&a[htsw] Renamed → ${trimmed}`);
    } catch (err) {
        ChatLib.chat(`&c[htsw] Rename failed: ${err}`);
        return;
    }
    editingPath = "";
    editingValue = "";
    if (onDoneCallback !== null) {
        try {
            onDoneCallback();
        } catch (_e) {
            /* ignore */
        }
    }
    closeSelf();
}

function popoverContent(fullPath: string): Element {
    syncFor(fullPath);
    return Col({
        style: { padding: 6, gap: 4 },
        children: [
            Text({
                text: `Rename ${basename(fullPath)}`,
                style: { width: { kind: "grow" } },
            }),
            Input({
                id: "rename-file-input",
                value: () => editingValue,
                onChange: (v) => {
                    editingValue = v;
                },
                onSubmit: () => save(fullPath),
                placeholder: "new filename…",
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
                        onClick: () => save(fullPath),
                    }),
                    Button({
                        text: "Cancel",
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "px", value: 18 },
                        },
                        onClick: () => {
                            editingPath = "";
                            editingValue = "";
                            closeSelf();
                        },
                    }),
                ],
            }),
        ],
    });
}

export function openRenameFilePopover(
    anchor: Rect,
    fullPath: string,
    onDone?: () => void
): void {
    syncFor(fullPath);
    onDoneCallback = onDone ?? null;
    activeHandle = openPopover({
        anchor,
        content: popoverContent(fullPath),
        width: 240,
        height: 64,
        key: `rename-file:${fullPath}`,
        onClose: () => {
            activeHandle = null;
        },
    });
}
