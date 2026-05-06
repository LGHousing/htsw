/// <reference types="../../../CTAutocomplete" />

import type { Element } from "../lib/layout";
import { Button, Col, Container, Row, Text } from "../lib/components";
import {
    ACCENT_SUCCESS,
    COLOR_BUTTON_DANGER,
    COLOR_BUTTON_DANGER_HOVER,
    COLOR_PANEL_BORDER,
    COLOR_TEXT_DIM,
} from "../lib/theme";
import { TaskManager } from "../../tasks/manager";
import { getImportProgress, getImportProgressFraction } from "../state";

const COLOR_BAR_BG = COLOR_PANEL_BORDER;
const COLOR_BAR_FG = ACCENT_SUCCESS;
const PROGRESS_BAR_H = 6;

function progressBar(): Element {
    return Container({
        style: {
            direction: "row",
            width: { kind: "grow" },
            height: { kind: "px", value: PROGRESS_BAR_H },
            background: COLOR_BAR_BG,
        },
        children: () => {
            const p = getImportProgress();
            if (p === null || p.weightTotal <= 0) return [];
            const ratio = getImportProgressFraction();
            return [
                Container({
                    style: {
                        width: { kind: "grow", factor: Math.max(0.0001, ratio) },
                        height: { kind: "grow" },
                        background: COLOR_BAR_FG,
                    },
                    children: [],
                }),
                Container({
                    style: {
                        width: { kind: "grow", factor: Math.max(0.0001, 1 - ratio) },
                        height: { kind: "grow" },
                    },
                    children: [],
                }),
            ];
        },
    });
}

function infoRow(): Element {
    return Row({
        style: { gap: 6, height: { kind: "px", value: 12 }, align: "center" },
        children: [
            Text({
                text: () => `${Math.floor(getImportProgressFraction() * 100)}%`,
                color: COLOR_TEXT_DIM,
                style: { width: { kind: "grow" } },
            }),
            Button({
                text: "✕ Cancel",
                style: {
                    width: { kind: "px", value: 50 },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON_DANGER,
                    hoverBackground: COLOR_BUTTON_DANGER_HOVER,
                },
                onClick: () => {
                    if (getImportProgress() === null) return;
                    TaskManager.cancelAll();
                    ChatLib.chat(`&c[htsw] cancelling import…`);
                },
            }),
        ],
    });
}

export function LiveImporter(): Element {
    return Container({
        style: {
            width: { kind: "grow" },
            height: { kind: "grow" },
            padding: 3,
        },
        children: () => {
            if (getImportProgress() === null) return [];
            return [
                Col({
                    style: { width: { kind: "grow" }, height: { kind: "grow" }, gap: 3 },
                    children: [progressBar(), infoRow()],
                }),
            ];
        },
    });
}
