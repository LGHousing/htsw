import type { Parser } from "./parser";

type RawFieldHandler<T> = {
    required: undefined extends T ? false : true;
    parse: (field: Parser) => void;
};

type RawFieldHandlers<T extends object> = {
    [K in keyof T]-?: RawFieldHandler<T[K]>;
};

export function parseRawFields<T extends object>(
    parser: Parser,
    handlers: RawFieldHandlers<T>
): void {
    for (const name of Object.keys(handlers) as Array<keyof T & string>) {
        const handler = handlers[name];
        const field = handler.required
            ? parser.parseField(name)
            : parser.parseFieldOrUndefined(name);
        if (field !== undefined) handler.parse(field);
    }
}

export function requiredRawField(
    parse: (field: Parser) => void
): { required: true; parse: (field: Parser) => void } {
    return { required: true, parse };
}

export function optionalRawField(
    parse: (field: Parser) => void
): { required: false; parse: (field: Parser) => void } {
    return { required: false, parse };
}
