import { Element } from "../lib/layout";
import { Col, Container } from "../lib/components";
import { TabBar, getActiveTab } from "./tabs";

const DIVIDER_COLOR = 0xff2c323b | 0;

function Divider(): Element {
    return Container({
        style: { height: { kind: "px", value: 1 }, background: DIVIDER_COLOR },
        children: [],
    });
}

const PANEL_PAD = 6;

export function LeftPanel(width: number): Element {
    return Col({
        style: {
            padding: PANEL_PAD,
            gap: 6,
            width: { kind: "grow" },
            height: { kind: "grow" },
        },
        children: () => [
            TabBar(),
            Divider(),
            Container({
                anchorKey: "tour:left-body",
                style: { width: { kind: "grow" }, height: { kind: "grow" } },
                children: () => [getActiveTab().content(width - PANEL_PAD * 2)],
            }),
        ],
    });
}
