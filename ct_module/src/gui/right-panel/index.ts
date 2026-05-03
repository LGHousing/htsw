import { Element } from "../layout";
import { Button, Col, Row, Text } from "../components";
import { getTabs, getActivePath, setActiveTab, confirmSelect, Tab } from "../selection";

const TAB_BG = 0xff2c323b | 0;
const TAB_BG_HOVER = 0xff3a4350 | 0;
const TAB_BG_ACTIVE = 0xff4a5566 | 0;
const TAB_BG_ACTIVE_HOVER = 0xff586477 | 0;

function stem(p: string): string {
    const slash = p.lastIndexOf("/");
    const base = slash < 0 ? p : p.substring(slash + 1);
    const dot = base.lastIndexOf(".");
    return dot <= 0 ? base : base.substring(0, dot);
}

function tabButton(tab: Tab): Element {
    const isActive = getActivePath() === tab.path;
    const label = tab.confirmed ? stem(tab.path) : `§o${stem(tab.path)}`;
    return Button({
        text: label,
        style: {
            width: { kind: "grow" },
            height: { kind: "grow" },
            background: isActive ? TAB_BG_ACTIVE : TAB_BG,
            hoverBackground: isActive ? TAB_BG_ACTIVE_HOVER : TAB_BG_HOVER,
        },
        onClick: () => setActiveTab(tab.path),
        onDoubleClick: () => confirmSelect(tab.path),
    });
}

export function RightPanel(): Element {
    return Col({
        style: { padding: 6, gap: 4 },
        children: [
            Row({
                style: { gap: 2, height: { kind: "px", value: 18 } },
                children: () => getTabs().map(tabButton),
            }),
            Text({
                text: () => getActivePath() ?? "",
                style: { width: { kind: "grow" } },
            }),
        ],
    });
}
