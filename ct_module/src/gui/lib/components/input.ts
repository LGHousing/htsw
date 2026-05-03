import { Element, Style } from "../layout";
import { Extractable } from "../extractable";

export type InputProps = {
    id: string;
    value: Extractable<string>;
    onChange: (v: string) => void;
    style?: Style;
    placeholder?: string;
};

export function Input(props: InputProps): Element {
    return {
        kind: "input",
        style: props.style ?? {},
        id: props.id,
        value: props.value,
        onChange: props.onChange,
        placeholder: props.placeholder,
    };
}
