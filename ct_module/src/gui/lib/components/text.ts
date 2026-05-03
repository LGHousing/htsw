import { Element, Style } from "../layout";
import { Extractable } from "../extractable";

export type TextProps = {
    text: Extractable<string>;
    style?: Style;
    color?: number;
};

export function Text(props: TextProps): Element {
    return {
        kind: "text",
        style: props.style ?? {},
        text: props.text,
        color: props.color,
    };
}
