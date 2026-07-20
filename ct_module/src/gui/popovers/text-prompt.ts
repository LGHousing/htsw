/// <reference types="../../../CTAutocomplete" />

import { Element } from "../lib/layout";
import { Button, Col, Input, Row, Text } from "../lib/components";
import { COLOR_TEXT_DIM } from "../lib/theme";
import { closePopover, openPopover, type PopoverHandle } from "../lib/popovers";

// One shared "ask for a string" modal: title, optional hint lines, input,
// submit/cancel. Callers that need more than a single text field build their
// own popover.
export type TextPromptOptions = {
    title: string;
    /** Dim explanatory lines shown under the title, above the input. */
    description?: string[];
    placeholder?: string;
    prefill?: string;
    submitLabel?: string;
    onEmptySubmit?: () => void;
    /** Popover width; widen when the hint lines need the room. Defaults to 240. */
    width?: number;
    /** Called with the trimmed, non-empty value after the prompt closes. */
    onSubmit: (value: string) => void;
};

let draft = "";
let options: TextPromptOptions | null = null;
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
        options?.onEmptySubmit?.();
        return;
    }
    const opts = options;
    draft = "";
    options = null;
    closeSelf();
    if (opts !== null) {
        try {
            opts.onSubmit(trimmed);
        } catch (err) {
            ChatLib.chat(`&c[htsw] ${String(err)}`);
        }
    }
}

function popoverContent(opts: TextPromptOptions): Element {
    const hintLines = (opts.description ?? []).map((line) =>
        Text({
            text: line,
            color: COLOR_TEXT_DIM,
            truncate: true,
            style: { width: { kind: "grow" } },
        })
    );
    return Col({
        style: { padding: 6, gap: 4 },
        children: [
            Text({
                text: opts.title,
                truncate: true,
                style: { width: { kind: "grow" } },
            }),
            ...hintLines,
            Input({
                id: "text-prompt-input",
                value: () => draft,
                onChange: (v) => {
                    draft = v;
                },
                onSubmit: () => submit(),
                placeholder: opts.placeholder ?? "",
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
                        text: opts.submitLabel ?? "OK",
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "px", value: 18 },
                        },
                        onClick: () => submit(),
                    }),
                    Button({
                        text: "Cancel",
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "px", value: 18 },
                        },
                        onClick: () => {
                            draft = "";
                            options = null;
                            closeSelf();
                        },
                    }),
                ],
            }),
        ],
    });
}

export function openTextPromptPopover(opts: TextPromptOptions): void {
    draft = opts.prefill ?? "";
    options = opts;
    activeHandle = openPopover({
        anchor: { x: 0, y: 0, w: 0, h: 0 },
        content: popoverContent(opts),
        width: opts.width ?? 240,
        height: 64 + (opts.description?.length ?? 0) * 12,
        key: "text-prompt",
        placement: "modal",
        onClose: () => {
            activeHandle = null;
        },
    });
}
