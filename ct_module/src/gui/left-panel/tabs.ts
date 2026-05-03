import { Element } from "../lib/layout";
import { Button, Col, Row, Text } from "../lib/components";
import { ExploreView } from "./explore";

export type TabId = "explore" | "knowledge" | "whatever";

type Tab = { id: TabId; label: string; content: () => Element };

export const TABS: Tab[] = [
    { id: "explore", label: "Explore", content: ExploreView },
    {
        id: "knowledge",
        label: "Knowledge",
        content: () =>
            Col({
                style: { gap: 6, height: { kind: "grow" }, padding: 4 },
                children: [Text({ text: "Knowledge stuff??", color: 0xff888888 | 0 })],
            }),
    },
    {
        id: "whatever",
        label: "Whatever",
        content: () =>
            Col({
                style: { gap: 6, height: { kind: "grow" }, padding: 4 },
                children: [Text({ text: "Whatever the frick!", color: 0xff888888 | 0 })],
            }),
    },
];

const TAB_ACTIVE_BG = 0xff67a7e8 | 0;

let activeTab: TabId = "explore";

export function getActiveTab(): Tab {
    for (let i = 0; i < TABS.length; i++) if (TABS[i].id === activeTab) return TABS[i];
    return TABS[0];
}

export function TabBar(): Element {
    return Row({
        style: { gap: 4, height: { kind: "px", value: 18 } },
        children: TABS.map((t) =>
            Button({
                text: t.label,
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: () => (activeTab === t.id ? TAB_ACTIVE_BG : undefined),
                    hoverBackground: () =>
                        activeTab === t.id ? TAB_ACTIVE_BG : undefined,
                },
                onClick: () => {
                    activeTab = t.id;
                },
            })
        ),
    });
}
