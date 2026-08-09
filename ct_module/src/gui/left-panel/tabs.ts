/// <reference types="../../../CTAutocomplete" />

import { Element } from "../lib/layout";
import { Button, Container, Row } from "../lib/components";
import { Icons } from "../lib/icons.generated";
import { ProjectsView } from "./projects";
import { HousesView } from "./houses";
import { SettingsView } from "./settings";
import {
    COLOR_TAB,
    COLOR_TAB_ACCENT,
    COLOR_TAB_ACTIVE,
    COLOR_TAB_ACTIVE_HOVER,
    COLOR_TAB_HOVER,
    COLOR_TEXT,
    SIZE_TAB_H,
} from "../lib/theme";
import { markGuiDirty } from "../lib/dirty";

type TabId = "projects" | "houses" | "settings";

type Tab = { id: TabId; label: string; content: (bodyW: number) => Element };

const TABS: Tab[] = [
    { id: "projects", label: "Projects", content: ProjectsView },
    { id: "houses", label: "Houses", content: HousesView },
    { id: "settings", label: "Settings", content: SettingsView },
];

let activeTab: TabId = "projects";

export function getActiveTab(): Tab {
    for (let i = 0; i < TABS.length; i++) if (TABS[i].id === activeTab) return TABS[i];
    return TABS[0];
}

export function setActiveLeftTab(id: TabId): void {
    if (activeTab === id) return;
    activeTab = id;
    markGuiDirty();
}

// Shared geometry for the icon-and-label house content tabs. Their labels
// collapse when the available width cannot fit the widest one.
export const TAB_GAP = 2;
const TAB_BUTTON_PAD_X = 4;
const TAB_ICON_W = 16;
const TAB_ICON_LABEL_GAP = 4;
const LABEL_FIT_MARGIN = 4;

export function tabLabelsFit(perTabW: number, labels: string[]): boolean {
    const labelSpace = perTabW - TAB_BUTTON_PAD_X * 2 - TAB_ICON_W - TAB_ICON_LABEL_GAP;
    let widestLabel = 0;
    for (let i = 0; i < labels.length; i++) {
        const w = Renderer.getStringWidth(labels[i]);
        if (w > widestLabel) widestLabel = w;
    }
    return labelSpace - LABEL_FIT_MARGIN >= widestLabel;
}

function tabButton(t: Tab): Element {
    const isActive = activeTab === t.id;
    return Container({
        style: {
            direction: "col",
            width: { kind: "grow" },
            height: { kind: "grow" },
        },
        children: [
            Button({
                text: t.label,
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: isActive ? COLOR_TAB_ACTIVE : COLOR_TAB,
                    hoverBackground: isActive ? COLOR_TAB_ACTIVE_HOVER : COLOR_TAB_HOVER,
                },
                onClick: () => {
                    setActiveLeftTab(t.id);
                },
            }),
            Container({
                style: {
                    width: { kind: "grow" },
                    height: { kind: "px", value: 2 },
                    background: isActive ? COLOR_TAB_ACCENT : undefined,
                },
                children: [],
            }),
        ],
    });
}

function settingsButton(): Element {
    const settings = TABS[2];
    const isActive = activeTab === settings.id;
    return Container({
        style: {
            direction: "col",
            width: { kind: "px", value: SIZE_TAB_H + 2 },
            height: { kind: "grow" },
        },
        children: [
            Button({
                icon: Icons.settings,
                tooltip: settings.label,
                tooltipColor: COLOR_TEXT,
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    padding: 0,
                    background: isActive ? COLOR_TAB_ACTIVE : COLOR_TAB,
                    hoverBackground: isActive ? COLOR_TAB_ACTIVE_HOVER : COLOR_TAB_HOVER,
                },
                onClick: () => setActiveLeftTab(settings.id),
            }),
            Container({
                style: {
                    width: { kind: "grow" },
                    height: { kind: "px", value: 2 },
                    background: isActive ? COLOR_TAB_ACCENT : undefined,
                },
                children: [],
            }),
        ],
    });
}

export function TabBar(): Element {
    return Row({
        style: {
            gap: 6,
            height: { kind: "px", value: SIZE_TAB_H + 2 },
            width: { kind: "grow" },
        },
        children: [
            Row({
                style: {
                    gap: TAB_GAP,
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                },
                children: [tabButton(TABS[0]), tabButton(TABS[1])],
            }),
            settingsButton(),
        ],
    });
}
