/// <reference types="../../../../CTAutocomplete" />

import type { Element } from "../../lib/layout";
import { Col, Container, Icon, Text } from "../../lib/components";
import { Icons, type IconName } from "../../lib/icons.generated";
import {
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
    COLOR_TOGGLE_ON,
    COLOR_TOGGLE_ON_HOVER,
    SIZE_ROW_H,
} from "../../lib/theme";
import {
    areTaskSoundsMuted,
    isImportCompletionSoundEnabled,
    setImportCompletionSoundEnabled,
    setTaskSoundsMuted,
} from "../../state/flags";
import {
    getAutoUpdatePreference,
    getRestoreWorkspace,
    getShowChatPanel,
    getShowInventoryButtons,
    getSmoothScrolling,
    getUnmatchedFunctionsFirst,
    getUploadDiagnostics,
    getAutoRun,
    setRestoreWorkspace,
    setShowChatPanel,
    setShowInventoryButtons,
    setSmoothScrolling,
    setUnmatchedFunctionsFirst,
    setUploadDiagnostics,
} from "../../../settings";
import { commandUpdate } from "../../../autoUpdate";
import { setAutoRunEnabled } from "../../autoRun";

type ToggleRow = {
    icon: () => IconName;
    label: string;
    isOn: () => boolean;
    onToggle: () => void;
};

function toggleRow(opts: ToggleRow): Element {
    return Container({
        style: {
            direction: "row",
            align: "center",
            gap: 6,
            padding: { side: "x", value: 8 },
            height: { kind: "px", value: SIZE_ROW_H + 4 },
            background: () => (opts.isOn() ? COLOR_TOGGLE_ON : COLOR_BUTTON),
            hoverBackground: () =>
                opts.isOn() ? COLOR_TOGGLE_ON_HOVER : COLOR_BUTTON_HOVER,
        },
        onClick: (_rect, info) => {
            if (info.button !== 0) return;
            opts.onToggle();
        },
        children: [
            Icon({
                name: opts.icon,
                color: () => (opts.isOn() ? COLOR_TEXT : COLOR_TEXT_DIM),
                style: {
                    width: { kind: "px", value: 12 },
                    height: { kind: "px", value: 12 },
                },
            }),
            Text({
                text: opts.label,
                color: COLOR_TEXT,
                style: { width: { kind: "grow" } },
            }),
            Icon({
                name: () => (opts.isOn() ? Icons.toggleRight : Icons.toggleLeft),
                color: () => (opts.isOn() ? COLOR_TEXT : COLOR_TEXT_DIM),
                style: {
                    width: { kind: "px", value: 14 },
                    height: { kind: "px", value: 14 },
                },
            }),
        ],
    });
}

export function SettingsView(): Element {
    return Col({
        style: { gap: 6, height: { kind: "grow" }, padding: 4 },
        children: [
            toggleRow({
                icon: () => Icons.layoutPanelTop,
                label: "Show inventory buttons",
                isOn: () => getShowInventoryButtons(),
                onToggle: () => setShowInventoryButtons(!getShowInventoryButtons()),
            }),
            toggleRow({
                icon: () => Icons.messagesSquare,
                label: "Show chat panel",
                isOn: () => getShowChatPanel(),
                onToggle: () => setShowChatPanel(!getShowChatPanel()),
            }),
            toggleRow({
                icon: () => (getSmoothScrolling() ? Icons.waves : Icons.mouse),
                label: "Smooth scrolling",
                isOn: () => getSmoothScrolling(),
                onToggle: () => setSmoothScrolling(!getSmoothScrolling()),
            }),
            toggleRow({
                icon: () => Icons.listStart,
                label: "Unmatched functions first",
                isOn: () => getUnmatchedFunctionsFirst(),
                onToggle: () => setUnmatchedFunctionsFirst(!getUnmatchedFunctionsFirst()),
            }),
            toggleRow({
                icon: () => (areTaskSoundsMuted() ? Icons.volumeOff : Icons.volume2),
                label: "Mute sounds during tasks",
                isOn: () => areTaskSoundsMuted(),
                onToggle: () => setTaskSoundsMuted(!areTaskSoundsMuted()),
            }),
            toggleRow({
                icon: () =>
                    isImportCompletionSoundEnabled() ? Icons.bellRing : Icons.bell,
                label: "Play import completion sound",
                isOn: () => isImportCompletionSoundEnabled(),
                onToggle: () =>
                    setImportCompletionSoundEnabled(!isImportCompletionSoundEnabled()),
            }),
            toggleRow({
                icon: () => Icons.eye,
                label: "Auto-run queued Housing work",
                isOn: () => getAutoRun(),
                onToggle: () => setAutoRunEnabled(!getAutoRun()),
            }),
            toggleRow({
                icon: () => Icons.history,
                label: "Restore workspace on startup",
                isOn: () => getRestoreWorkspace(),
                onToggle: () => setRestoreWorkspace(!getRestoreWorkspace()),
            }),
            toggleRow({
                icon: () => Icons.refreshCw,
                label: "Automatic updates",
                isOn: () => getAutoUpdatePreference() === "enabled",
                onToggle: () =>
                    commandUpdate([
                        getAutoUpdatePreference() === "enabled" ? "disable" : "enable",
                    ]),
            }),
            toggleRow({
                icon: () => Icons.bug,
                label: "Share diagnostics",
                isOn: () => getUploadDiagnostics(),
                onToggle: () => setUploadDiagnostics(!getUploadDiagnostics()),
            }),
        ],
    });
}
