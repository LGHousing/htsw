/// <reference types="../../../../CTAutocomplete" />

import type { Element } from "../../lib/layout";
import { Button, Row } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import {
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_BUTTON_PRIMARY,
    COLOR_BUTTON_PRIMARY_HOVER,
    COLOR_TOGGLE_ON,
    COLOR_TOGGLE_ON_HOVER,
} from "../../lib/theme";
import { TaskManager } from "../../../tasks/manager";
import { getQueue, runnableQueueRowCount } from "./queue";
import { getHousingUuid } from "../../state";
import { cancelQueue, queueRunState, resumeQueue, startQueue } from "./queueRunner";
import { openFileBrowserWithHtslSelection } from "../../popovers/file-browser";
import { appendRawHtslFile } from "../../../rawHtslImport";
import { getAutoRun } from "../../../settings";
import { setAutoRunEnabled } from "../../autoRun";

export function queueControl(): Element {
    const runnable = (): number => runnableQueueRowCount(getQueue(), getHousingUuid());
    const runDisabled = (): boolean =>
        queueRunState() === "idle" && (TaskManager.isBusy() || runnable() === 0);
    const runTooltip = (): string => {
        const state = queueRunState();
        if (state === "running") return "Pause after cancelling the current session.";
        if (state === "paused") return "Resume queued Housing work.";
        if (TaskManager.isBusy()) return "Another task is already running.";
        if (runnable() === 0) return "Nothing is queued for this house.";
        return "Run queued Housing work for this house.";
    };

    return Row({
        style: { gap: 4, height: { kind: "px", value: 18 } },
        children: [
            Button({
                icon: () => (queueRunState() === "running" ? Icons.square : Icons.play),
                text: () => {
                    const n = runnable();
                    const state = queueRunState();
                    if (state === "running") return "Cancel";
                    if (state === "paused") return `Resume (${n})`;
                    return `Run (${n})`;
                },
                disabled: runDisabled,
                tooltip: runTooltip,
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON_PRIMARY,
                    hoverBackground: COLOR_BUTTON_PRIMARY_HOVER,
                },
                onClick: () => {
                    const state = queueRunState();
                    if (state === "running") cancelQueue();
                    else if (state === "paused") resumeQueue();
                    else startQueue();
                },
            }),
            Button({
                icon: () => (getAutoRun() ? Icons.toggleRight : Icons.toggleLeft),
                text: "Auto-run",
                tooltip: () =>
                    getAutoRun()
                        ? "Auto-run is on — queued work starts after two seconds."
                        : "Auto-run is off — queued work waits for Run.",
                style: {
                    width: { kind: "px", value: 88 },
                    height: { kind: "grow" },
                    background: () => (getAutoRun() ? COLOR_TOGGLE_ON : COLOR_BUTTON),
                    hoverBackground: () =>
                        getAutoRun() ? COLOR_TOGGLE_ON_HOVER : COLOR_BUTTON_HOVER,
                },
                onClick: () => setAutoRunEnabled(!getAutoRun()),
            }),
            Button({
                icon: Icons.fileUp,
                text: "Append HTSL",
                disabled: () => TaskManager.isBusy(),
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
