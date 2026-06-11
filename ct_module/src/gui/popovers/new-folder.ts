/// <reference types="../../../CTAutocomplete" />

import { Element } from "../lib/layout";
import { Button, Col, Input, Row, Text } from "../lib/components";
import { closePopover, openPopover, type PopoverHandle } from "../lib/popovers";

let draft = "";
let onCreateCallback: ((name: string) => void) | null = null;
let activeHandle: PopoverHandle | null = null;

function closeSelf(): void {
    if (activeHandle !== null) {
        closePopover(activeHandle);
        activeHandle = null;
    }
}

function submit(): void {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
        ChatLib.chat("&c[htsw] Folder name can't be empty.");
        return;
    }
    const cb = onCreateCallback;
    draft = "";
    closeSelf();
    if (cb !== null) {
        try {
            cb(trimmed);
        } catch (_e) {
            /* ignore */
        }
    }
}

function popoverContent(): Element {
    return Col({
        style: { padding: 6, gap: 4 },
        children: [
            Text({ text: "New folder", style: { width: { kind: "grow" } } }),
            Input({
                id: "new-folder-input",
                value: () => draft,
                onChange: (v) => {
                    draft = v;
                },
                onSubmit: () => submit(),
                placeholder: "folder name…",
                style: { width: { kind: "grow" }, height: { kind: "px", value: 18 } },
            }),
            Row({
                style: {
                    width: { kind: "grow" },
                    height: { kind: "px", value: 18 },
                    gap: 4,
                },
                children: [
                    Button({
                        text: "Create",
                        style: { width: { kind: "grow" }, height: { kind: "px", value: 18 } },
                        onClick: () => submit(),
                    }),
                    Button({
                        text: "Cancel",
                        style: { width: { kind: "grow" }, height: { kind: "px", value: 18 } },
                        onClick: () => {
                            draft = "";
                            closeSelf();
                        },
                    }),
                ],
            }),
        ],
    });
}

export function openNewFolderPopover(
    prefill: string,
    onCreate: (name: string) => void
): void {
    draft = prefill;
    onCreateCallback = onCreate;
    activeHandle = openPopover({
        anchor: { x: 0, y: 0, w: 0, h: 0 },
        content: popoverContent(),
        width: 240,
        height: 64,
        key: "new-folder",
        placement: "modal",
        onClose: () => {
            activeHandle = null;
        },
    });
}
