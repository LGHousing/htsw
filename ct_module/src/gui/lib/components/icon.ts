import { Element, Style } from "../layout";
import { Extractable } from "../extractable";
import { IconName } from "../icons.generated";

export type IconProps = {
    // Use `Icons.foo` (typed as IconName) so the string literal flows into the bundle
    // and the build-time PNG tree-shake catches it. Dynamic strings would skip the
    // shake and fail at runtime — typing this as `IconName` is the guard.
    name: Extractable<IconName>;
    style?: Style;
};

const DEFAULT_SIZE: Style = {
    width: { kind: "px", value: 16 },
    height: { kind: "px", value: 16 },
};

export function Icon(props: IconProps): Element {
    return {
        kind: "image",
        style: props.style ?? DEFAULT_SIZE,
        name: props.name,
    };
}
