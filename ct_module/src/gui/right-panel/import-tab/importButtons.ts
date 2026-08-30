/// <reference types="../../../../CTAutocomplete" />

import type { Element } from "../../lib/layout";
import { Button, Row } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import {
    COLOR_BUTTON_PRIMARY,
    COLOR_BUTTON_PRIMARY_HOVER,
} from "../../lib/theme";
import { TaskManager } from "../../../tasks/manager";
import { getQueueLength } from "./queue";
import { isImportPreparationRunning, startImport } from "./taskController";
import { openFileBrowserWithHtslSelection } from "../../popovers/file-browser";
import { appendRawHtslFile } from "../../../rawHtslImport";
import { startOpenActionListExport } from "../../export/openActionListExport";

export function importControl(): Element {
    const importDisabled = (): boolean =>
        TaskManager.isBusy() || isImportPreparationRunning() || getQueueLength() === 0;
    const importTooltip = (): string => {
        if (TaskManager.isBusy()) return "Another task is already running.";
        if (isImportPreparationRunning()) return "Checking queued project files…";
        if (getQueueLength() === 0) return "No changes queued to import.";
        return "";
    };

    return Row({
        style: { gap: 4, height: { kind: "px", value: 18 } },
        children: [
            Button({
                icon: Icons.upload,
                text: () => {
                    const n = getQueueLength();
                    return n === 0 ? "Import" : `Import (${n})`;
                },
                disabled: importDisabled,
                tooltip: importTooltip,
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON_PRIMARY,
                    hoverBackground: COLOR_BUTTON_PRIMARY_HOVER,
                },
                onClick: () => startImport(),
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
            Button({
                icon: Icons.download,
                text: "Export HTSL",
                disabled: () => TaskManager.isBusy() || isImportPreparationRunning(),
                tooltip:
                    "Exports the open Housing action list to a standalone .htsl file.",
                style: {
                    width: { kind: "px", value: 116 },
                    height: { kind: "grow" },
                },
                onClick: () => startOpenActionListExport(),
            }),
        ],
    });
}
