import { Element, Style } from "../layout";
import { Extractable } from "../extractable";

export type TextProps = {
    text: Extractable<string>;
    style?: Style;
    color?: Extractable<number | undefined>;
    underlineColor?: Extractable<number | undefined>;
    tooltip?: Extractable<string>;
    tooltipColor?: Extractable<number>;
    truncate?: boolean;
};

export function Text(props: TextProps): Element {
    return {
        kind: "text",
        style: props.style ?? {},
        text: props.text,
        color: props.color,
        underlineColor: props.underlineColor,
        tooltip: props.tooltip,
        tooltipColor: props.tooltipColor,
        truncate: props.truncate,
    };
}
