import { Element } from "../layout";
import { Col, Container } from "../components";
import { TabBar, getActiveTab } from "./tabs";

const DIVIDER_COLOR = 0xff2c323b | 0;

function Divider(): Element {
    return Container({
        style: { height: { kind: "px", value: 1 }, background: DIVIDER_COLOR },
        children: [],
    });
}

export function LeftPanel(): Element {
    return Col({
        style: {
            padding: 6,
            gap: 6,
            width: { kind: "grow" },
            height: { kind: "grow" },
        },
        children: () => [TabBar(), Divider(), getActiveTab().content()],
    });
}
