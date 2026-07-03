/// <reference types="../../../CTAutocomplete" />

import { Element } from "../lib/layout";
import { Button, Col, Container, Icon, Input, Row, Text } from "../lib/components";
import { Icons } from "../lib/icons.generated";
import { COLOR_TEXT_DIM } from "../lib/theme";
import { closePopover, openPopover, type PopoverHandle } from "../lib/popovers";

let draft = "";
let sectionFoldersDraft = true;
let onCreateCallback: ((name: string, sectionFolders: boolean) => void) | null = null;
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
        ChatLib.chat("&c[htsw] Project name can't be empty.");
        return;
    }
    const cb = onCreateCallback;
    const sectionFolders = sectionFoldersDraft;
    draft = "";
    closeSelf();
    if (cb !== null) {
        try {
            cb(trimmed, sectionFolders);
        } catch (_e) {
            /* ignore */
        }
    }
}

function popoverContent(): Element {
    return Col({
        style: { padding: 6, gap: 4 },
        children: [
            Text({ text: "New project", style: { width: { kind: "grow" } } }),
            Input({
                id: "new-project-input",
                value: () => draft,
                onChange: (v) => {
                    draft = v;
                },
                onSubmit: () => submit(),
                placeholder: "project name…",
                style: { width: { kind: "grow" }, height: { kind: "px", value: 18 } },
            }),
            Container({
                style: {
                    direction: "row",
                    align: "center",
                    gap: 4,
                    width: { kind: "grow" },
                    height: { kind: "px", value: 12 },
                },
                onClick: () => {
                    sectionFoldersDraft = !sectionFoldersDraft;
                },
                children: [
                    Icon({
                        name: () => (sectionFoldersDraft ? Icons.squareCheck : Icons.square),
                        style: { width: { kind: "px", value: 10 }, height: { kind: "px", value: 10 } },
                    }),
                    Text({
                        text: "Folder per type (functions/, events/, …)",
                        color: COLOR_TEXT_DIM,
                        truncate: true,
                        style: { width: { kind: "grow" } },
                    }),
                ],
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

export function openNewProjectPopover(
    prefill: string,
    onCreate: (name: string, sectionFolders: boolean) => void
): void {
    draft = prefill;
    sectionFoldersDraft = true;
    onCreateCallback = onCreate;
    activeHandle = openPopover({
        anchor: { x: 0, y: 0, w: 0, h: 0 },
        content: popoverContent(),
        width: 240,
        height: 82,
        key: "new-project",
        placement: "modal",
        onClose: () => {
            activeHandle = null;
        },
    });
}
