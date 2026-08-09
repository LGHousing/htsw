import type { Element } from "../lib/layout";
import { Button, Container, Icon } from "../lib/components";
import { Icons } from "../lib/icons.generated";
import { COLOR_BUTTON, COLOR_BUTTON_HOVER, COLOR_TEXT_DIM } from "../lib/theme";
import { togglePopover } from "../lib/popovers";
import { exportDestinationPicker } from "./destinationPicker";
import { getExportDestinationStatus } from "./destinationStatus";

export function exportDestinationButton(): Element {
    return Container({
        anchorKey: "tour:export-destination",
        style: {
            width: { kind: "px", value: 24 },
            height: { kind: "grow" },
        },
        children: [
            Button({
                children: [
                    Icon({
                        name: Icons.folderOutput,
                        style: {
                            width: { kind: "px", value: 12 },
                            height: { kind: "px", value: 12 },
                        },
                    }),
                ],
                tooltip: () => {
                    const status = getExportDestinationStatus();
                    if (status.kind === "ready") return "Change where exports go";
                    if (status.kind === "missing") {
                        return "Choose a replacement export project";
                    }
                    return "Choose an export project";
                },
                tooltipColor: COLOR_TEXT_DIM,
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    padding: 0,
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: (rect) =>
                    togglePopover({
                        key: "houses-export-destination",
                        anchor: rect,
                        content: exportDestinationPicker(),
                        width: 380,
                        height: 320,
                    }),
            }),
        ],
    });
}
