/// <reference types="../../../../CTAutocomplete" />

import type { Element } from "../../lib/layout";
import { Button, Row } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import {
    COLOR_BUTTON_PRIMARY,
    COLOR_BUTTON_PRIMARY_HOVER,
} from "../../lib/theme";
import { isParseInProgress } from "../../state";
import { getQueueLength } from "./queue";
import { startImport } from "./taskController";

export function importControl(): Element {
    const importDisabled = (): boolean => getQueueLength() === 0 || isParseInProgress();
    const importTooltip = (): string => {
        if (isParseInProgress()) return "Project is still loading. Import will be available when it finishes.";
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
        ],
    });
}
