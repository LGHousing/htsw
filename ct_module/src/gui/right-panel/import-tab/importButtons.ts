/// <reference types="../../../../CTAutocomplete" />

import type { Element } from "../../lib/layout";
import { Button, Row } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import { COLOR_BUTTON_PRIMARY, COLOR_BUTTON_PRIMARY_HOVER } from "../../lib/theme";
import { TaskManager } from "../../../tasks/manager";
import { getQueueLength, hasRunnableQueueItem, isQueueProcessing } from "./queue";
import { isImportPreparationRunning } from "./taskController";
import { startOperationQueue } from "./operationQueueController";
import { openFileBrowserWithHtslSelection } from "../../popovers/file-browser";
import { appendRawHtslFile } from "../../../rawHtslImport";

export function importControl(): Element {
    const importDisabled = (): boolean =>
        TaskManager.isBusy() ||
        isImportPreparationRunning() ||
        isQueueProcessing() ||
        !hasRunnableQueueItem();
    const importTooltip = (): string => {
        if (isQueueProcessing()) return "The queue is running.";
        if (TaskManager.isBusy()) return "Another task is already running.";
        if (isImportPreparationRunning()) return "Checking queued project files…";
        if (getQueueLength() === 0) return "No Housing operations are queued.";
        if (!hasRunnableQueueItem())
            return "Resolve, retry, or dismiss the blocked work first.";
        return "";
    };

    return Row({
        style: { gap: 4, height: { kind: "px", value: 18 } },
        children: [
            Button({
                icon: Icons.upload,
                text: () => {
                    const n = getQueueLength();
                    return n === 0 ? "Run queue" : `Run queue (${n})`;
                },
                disabled: importDisabled,
                tooltip: importTooltip,
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON_PRIMARY,
                    hoverBackground: COLOR_BUTTON_PRIMARY_HOVER,
                },
                onClick: () => startOperationQueue(),
            }),
            Button({
                icon: Icons.fileUp,
                text: "Append HTSL",
                disabled: () => TaskManager.isBusy() || isImportPreparationRunning(),
                tooltip: "Appends a raw .htsl file to the open Housing action list.",
                style: {
                    width: { kind: "px", value: 116 },
                    height: { kind: "grow" },
                },
                onClick: () =>
                    openFileBrowserWithHtslSelection(undefined, appendRawHtslFile),
            }),
        ],
    });
}
