import { Child, ClickInfo, ContainerStyle, Element, Rect } from "../layout";
import { Extractable, extract } from "../extractable";
import { IconName } from "../icons.generated";
import { COLOR_BUTTON, COLOR_BUTTON_DISABLED, COLOR_BUTTON_HOVER, COLOR_TEXT_FAINT } from "../theme";
import { Container } from "./container";
import { Icon } from "./icon";
import { Text } from "./text";

export type ButtonProps = {
    onClick: (rect: Rect, info: ClickInfo) => void;
    onDoubleClick?: (rect: Rect) => void;
    // When true the button paints recessed with faint text/icon, drops its
    // hover/click flash, and consumes clicks without firing handlers.
    // Extractable so callers can drive it from live state (e.g. an empty
    // queue) without rebuilding the element.
    disabled?: Extractable<boolean>;
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
    tooltip?: Extractable<string>;
    tooltipColor?: Extractable<number>;
};

// Buttons are styled clickable Containers, not their own primitive: removing
// `kind: "button"` collapsed two render branches and made buttons compose
// freely with anything else (icons, badges, custom layouts). Defaults below
// match the look of the old primitive — same theme colors, same row+center
// layout, same horizontal padding.
const DEFAULT_PADDING = { side: "x" as const, value: 4 };

export function Button(props: ButtonProps): Element {
    const userStyle = props.style ?? {};
    const baseBackground = userStyle.background ?? COLOR_BUTTON;
    const baseHoverBackground = userStyle.hoverBackground ?? COLOR_BUTTON_HOVER;

    // Buttons without `disabled` keep static colors and an untinted icon.
    const disabledAware = props.disabled !== undefined;
    const isDisabled = (): boolean => extract(props.disabled ?? false);

    const background: Extractable<number | undefined> = disabledAware
        ? () => (isDisabled() ? COLOR_BUTTON_DISABLED : extract(baseBackground))
        : baseBackground;
    const hoverBackground: Extractable<number | undefined> = disabledAware
        ? () => (isDisabled() ? COLOR_BUTTON_DISABLED : extract(baseHoverBackground))
        : baseHoverBackground;
    const textColor: Extractable<number | undefined> | undefined = disabledAware
        ? () => (isDisabled() ? COLOR_TEXT_FAINT : extract(props.textColor ?? undefined))
        : props.textColor;
    const iconColor: Extractable<number | undefined> | undefined = disabledAware
        ? () => (isDisabled() ? COLOR_TEXT_FAINT : undefined)
        : undefined;

    const builtChildren: Child[] | undefined =
        props.children !== undefined
            ? undefined
            : buildShorthandChildren(props.icon, props.text, textColor, iconColor);
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
            background,
            hoverBackground,
            // Sizes pass through so callers keep their grow/px sizing.
            width: userStyle.width,
            height: userStyle.height,
        },
        children,
        disabled: disabledAware ? props.disabled : undefined,
        onClick: props.onClick,
        onDoubleClick: props.onDoubleClick,
        tooltip: props.tooltip,
        tooltipColor: props.tooltipColor,
    });
}

function buildShorthandChildren(
    icon: Extractable<IconName> | undefined,
    text: Extractable<string> | undefined,
    textColor: Extractable<number | undefined> | undefined,
    iconColor: Extractable<number | undefined> | undefined
): Child[] {
    const out: Child[] = [];
    if (icon !== undefined) out.push(Icon({ name: icon, color: iconColor }));
    if (text !== undefined) out.push(Text({ text, color: textColor }));
    return out;
}
