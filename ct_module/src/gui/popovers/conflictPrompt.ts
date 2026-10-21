import { conflictPrompts } from "@htsw/importer/runtime/conflictPrompt";
import { closeConfirmPopover, openConfirmPopover } from "./confirm";

export function renderConflictPrompt(
    event: Parameters<typeof conflictPrompts.emit>[0]
): void {
    if (event.kind === "close") {
        closeConfirmPopover();
        return;
    }
    const { options, answer } = event;
    openConfirmPopover({
        title: options.title,
        lines: options.lines,
        confirmLabel: options.confirmLabel,
        extraLabel: options.extraLabel,
        cancelLabel: options.cancelLabel,
        danger: options.danger,
        onConfirm: () => answer(true),
        onExtra:
            options.onExtra === undefined
                ? undefined
                : () => {
                      options.onExtra?.();
                      answer(false);
                  },
        onClose: () => answer(false),
    });
}
