import { Element, Style } from "../layout";
import { Extractable } from "../extractable";

export type ButtonProps = {
    text: Extractable<string>;
    onClick: () => void;
    style?: Style;
};

export function Button(props: ButtonProps): Element {
    return {
        kind: "button",
        style: props.style ?? {},
        text: props.text,
        onClick: props.onClick,
    };
}
