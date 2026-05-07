import { Child, ClickInfo, ContainerStyle, Element, Rect } from "../layout";
import { Extractable } from "../extractable";
import { IconName } from "../icons.generated";
import { COLOR_BUTTON, COLOR_BUTTON_HOVER } from "../theme";
import { Container } from "./container";
import { Icon } from "./icon";
import { Text } from "./text";

export type ButtonProps = {
    onClick: (rect: Rect, info: ClickInfo) => void;
    onDoubleClick?: (rect: Rect) => void;
    style?: ContainerStyle;
    // Common shorthand: when only `text` and/or `icon` are passed the helper
    // builds [Icon?, Text?] in a centered Row. Pass `children` for fully
    // custom contents (badges, multiple icons, progress bars, etc.); doing
    // so suppresses the text/icon shorthand so callers can't accidentally
    // mix two layout sources.
    text?: Extractable<string>;
    textColor?: Extractable<number | undefined>;
    icon?: Extractable<IconName>;
    children?: Extractable<Child[]>;
};

// Buttons are styled clickable Containers, not their own primitive: removing
// `kind: "button"` collapsed two render branches and made buttons compose
// freely with anything else (icons, badges, custom layouts). Defaults below
// match the look of the old primitive — same theme colors, same row+center
// layout, same horizontal padding.
const DEFAULT_PADDING = { side: "x" as const, value: 4 };

export function Button(props: ButtonProps): Element {
    const userStyle = props.style ?? {};
    const builtChildren: Child[] | undefined =
        props.children !== undefined
            ? undefined
            : buildShorthandChildren(props.icon, props.text, props.textColor);
    const children: Extractable<Child[]> =
        props.children !== undefined ? props.children : (builtChildren as Child[]);

    return Container({
        style: {
            // Layout defaults — overridable by the caller.
            direction: userStyle.direction ?? "row",
            align: userStyle.align ?? "center",
            justify: userStyle.justify ?? "center",
            gap: userStyle.gap ?? 4,
            padding: userStyle.padding ?? DEFAULT_PADDING,
            // Color defaults — pulled from theme so a re-skin is one file.
            background: userStyle.background ?? COLOR_BUTTON,
            hoverBackground: userStyle.hoverBackground ?? COLOR_BUTTON_HOVER,
            // Sizes pass through so callers keep their grow/px sizing.
            width: userStyle.width,
            height: userStyle.height,
        },
        children,
        onClick: props.onClick,
        onDoubleClick: props.onDoubleClick,
    });
}

function buildShorthandChildren(
    icon: Extractable<IconName> | undefined,
    text: Extractable<string> | undefined,
    textColor: Extractable<number | undefined> | undefined
): Child[] {
    const out: Child[] = [];
    if (icon !== undefined) out.push(Icon({ name: icon }));
    if (text !== undefined) out.push(Text({ text, color: textColor }));
    return out;
}
