import type { Element } from "../lib/layout";
import { Button, Col, Container, Icon, Text } from "../lib/components";
import { Icons } from "../lib/icons.generated";
import {
    ACCENT_DANGER,
    ACCENT_WARN,
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
} from "../lib/theme";
import { basename, dirname, shortPath } from "../lib/pathDisplay";
import { togglePopover } from "../lib/popovers";
import { getEffectiveNewExportTarget } from "../state";
import { exportDestinationPicker } from "./destinationPicker";
import { getExportDestinationStatus } from "./destinationStatus";

/**
 * Label the new-entry target relative to the export project, since the row
 * above already names the project. The base file reads as `import.json`; a
 * sub-target reads as its folder path within the project.
 */
function newTargetLabel(projectImportJson: string): string {
    const target = shortPath(getEffectiveNewExportTarget());
    const projectDir = shortPath(projectImportJson);
    const targetKey = target.toLowerCase();
    const projectKey = projectDir.toLowerCase();
    if (targetKey === projectKey) return "import.json";
    if (targetKey.indexOf(`${projectKey}/`) === 0) {
        return target.substring(projectDir.length + 1);
    }
    return target;
}

export function exportDestinationControl(): Element {
    return Container({
        anchorKey: "tour:export-destination",
        style: { width: { kind: "grow" }, height: { kind: "px", value: 34 } },
        children: [
            Button({
                style: {
                    direction: "row",
                    justify: "start",
                    gap: 6,
                    padding: { side: "x", value: 8 },
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    align: "center",
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                tooltip: () => {
                    const status = getExportDestinationStatus();
                    if (status.kind === "ready") return "Change export destination";
                    if (status.kind === "missing") return "Choose a replacement export project";
                    return "Choose an export project";
                },
                tooltipColor: COLOR_TEXT_DIM,
                onClick: (rect) =>
                    togglePopover({
                        key: "houses-export-destination",
                        anchor: rect,
                        content: exportDestinationPicker(),
                        width: 380,
                        height: 320,
                    }),
                children: () => {
                    const status = getExportDestinationStatus();
                    if (status.kind === "none") {
                        return [
                            Icon({ name: Icons.folderPlus, color: ACCENT_WARN }),
                            Col({
                                style: { gap: 2, width: { kind: "grow" } },
                                children: [
                                    Text({ text: "No export project selected", color: ACCENT_WARN }),
                                    Text({
                                        text: "Choose or create a project before exporting",
                                        color: COLOR_TEXT_DIM,
                                        truncate: true,
                                    }),
                                ],
                            }),
                            Icon({ name: Icons.chevronRight, color: COLOR_TEXT_DIM }),
                        ];
                    }
                    if (status.kind === "missing") {
                        return [
                            Icon({ name: Icons.folderX, color: ACCENT_DANGER }),
                            Col({
                                style: { gap: 2, width: { kind: "grow" } },
                                children: [
                                    Text({ text: "Export project is missing", color: ACCENT_DANGER }),
                                    Text({
                                        text: shortPath(status.path),
                                        color: COLOR_TEXT_DIM,
                                        tooltip: status.path,
                                        tooltipColor: COLOR_TEXT_DIM,
                                        truncate: true,
                                    }),
                                ],
                            }),
                            Icon({ name: Icons.chevronRight, color: ACCENT_DANGER }),
                        ];
                    }
                    return [
                        Icon({ name: Icons.folderOutput }),
                        Col({
                            style: { gap: 2, width: { kind: "grow" } },
                            children: [
                                Text({
                                    text: `Export project: ${basename(dirname(status.path))}`,
                                    color: COLOR_TEXT,
                                    truncate: true,
                                }),
                                Text({
                                    text: `New entries go in: ${newTargetLabel(status.path)}`,
                                    color: COLOR_TEXT_DIM,
                                    tooltip: getEffectiveNewExportTarget(),
                                    tooltipColor: COLOR_TEXT_DIM,
                                    truncate: true,
                                }),
                            ],
                        }),
                        Icon({ name: Icons.chevronRight, color: COLOR_TEXT_DIM }),
                    ];
                },
            }),
        ],
    });
}
