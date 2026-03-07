import { Span } from "../../span";

export type Token = TokenType & { span: Span };

export type TokenType =
    | OpenDelimKind
    | CloseDelimKind
    | ColonKind
    | SemicolonKind
    | CommaKind
    | StrKind
    | BareKind
    | EofKind
    | UnknownKind;

export type OpenDelimKind = { kind: "open_delim"; delim: "brace" | "bracket" };
export type CloseDelimKind = { kind: "close_delim"; delim: "brace" | "bracket" };
export type ColonKind = { kind: "colon" };
export type SemicolonKind = { kind: "semicolon" };
export type CommaKind = { kind: "comma" };
export type StrKind = { kind: "str"; value: string };
export type BareKind = { kind: "bare"; value: string };
export type EofKind = { kind: "eof" };
export type UnknownKind = { kind: "unknown"; value: string };

export function token<K extends Token["kind"]>(
    kind: K,
    span: Span,
    props?: Omit<Extract<Token, { kind: K }>, "kind" | "span">,
): Token {
    return { kind, span, ...props } as Token;
}

const TOKEN_NAMES: Record<Token["kind"], string> = {
    open_delim: "opening delimiter",
    close_delim: "closing delimiter",
    colon: ":",
    semicolon: ";",
    comma: ",",
    str: "string",
    bare: "literal",
    eof: "end of file",
    unknown: "unknown token",
};

export function tokenToString(tok: Token["kind"] | Partial<Token>): string {
    if (typeof tok === "string") return TOKEN_NAMES[tok];

    switch (tok.kind) {
        case "open_delim":
            if (tok.delim === "brace") return "{";
            if (tok.delim === "bracket") return "[";
            return TOKEN_NAMES.open_delim;
        case "close_delim":
            if (tok.delim === "brace") return "}";
            if (tok.delim === "bracket") return "]";
            return TOKEN_NAMES.close_delim;
        case "unknown":
            return tok.value ?? TOKEN_NAMES.unknown;
        case undefined:
            throw Error("undefined token kind");
        default:
            return TOKEN_NAMES[tok.kind];
    }
}
