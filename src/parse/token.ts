import { Span } from '../span';

export type Token = TokenType & { span: Span };

export type TokenType =
    | CommaKind
    | ExclamationKind
    | BinOpKind
    | BinOpEqKind
    | CmpOpKind
    | CmpOpEqKind
    | OpenDelimKind
    | CloseDelimKind
    | StrKind
    | I64Kind
    | F64Kind
    | PlaceholderKind
    | IdentKind
    | EolKind
    | EofKind
    | UnknownKind;

export type CommaKind = { kind: 'comma' };
export type ExclamationKind = { kind: 'exclamation' };

export type BinOpKind = { kind: 'bin_op'; op: BinOp };
export type BinOpEqKind = { kind: 'bin_op_eq'; op: BinOp };

export type CmpOpKind = { kind: 'cmp_op'; op: CmpOp };
export type CmpOpEqKind = { kind: 'cmp_op_eq'; op: CmpOp };

export type OpenDelimKind = { kind: 'open_delim'; delim: Delimiter };
export type CloseDelimKind = { kind: 'close_delim'; delim: Delimiter };

export type StrKind = { kind: 'str'; value: string };
export type I64Kind = { kind: 'i64'; value: string };
export type F64Kind = { kind: 'f64'; value: string };
export type PlaceholderKind = { kind: 'placeholder'; value: string };

export type IdentKind = { kind: 'ident'; value: string };

export type EolKind = { kind: 'eol' };
export type EofKind = { kind: 'eof' };

export type UnknownKind = { kind: 'unknown'; value: string };

export type Delimiter = 'parenthesis' | 'brace' | 'bracket';

export type BinOp = 'plus' | 'minus' | 'star' | 'slash' | 'star_star';
export type CmpOp = 'greater_than' | 'less_than' | 'equals';

export function token<K extends Token['kind']>(
    kind: K,
    span: Span,
    props?: Omit<Extract<Token, { kind: K }>, 'kind' | 'span'>
): Token {
    return { kind, span, ...props } as Token;
}

const TOKEN_KIND_NAMES: {
    [key in Token['kind']]: string;
} = {
    comma: ',',
    exclamation: '!',
    bin_op: 'binary operator',
    bin_op_eq: 'binary operator',
    cmp_op: 'comparison',
    cmp_op_eq: 'comparison',
    open_delim: 'opening delimiter',
    close_delim: 'closing delimiter',
    str: 'string',
    i64: 'number',
    f64: 'number',
    placeholder: 'placeholder',
    ident: 'identifier',
    eol: 'end of line',
    eof: 'end of file',
    unknown: 'unknown token',
};

const DELIMITER_SYMBOLS: {
    [key in Delimiter]: string;
} = {
    parenthesis: '()',
    brace: '{}',
    bracket: '[]',
};

const BIN_OP_SYMBOLS: {
    [key in BinOp]: string;
} = {
    plus: '+',
    minus: '-',
    star: '*',
    slash: '/',
    star_star: '**',
};

const CMP_OP_SYMBOLS: {
    [key in CmpOp]: string;
} = {
    greater_than: '>',
    less_than: '<',
    equals: '=',
};

export function tokenToString(tok: Token['kind'] | Partial<Token>) {
    if (typeof tok === 'string') {
        return TOKEN_KIND_NAMES[tok];
    }

    switch (tok.kind) {
        case 'comma':
            return ',';
        case 'bin_op':
            return tok.op ? BIN_OP_SYMBOLS[tok.op] : TOKEN_KIND_NAMES[tok.kind];
        case 'bin_op_eq':
            return tok.op ? `${BIN_OP_SYMBOLS[tok.op]}=` : TOKEN_KIND_NAMES[tok.kind];
        case 'cmp_op':
            return tok.op ? CMP_OP_SYMBOLS[tok.op] : TOKEN_KIND_NAMES[tok.kind];
        case 'cmp_op_eq':
            return tok.op ? `${CMP_OP_SYMBOLS[tok.op]}=` : TOKEN_KIND_NAMES[tok.kind];
        case 'open_delim':
            return tok.delim
                ? DELIMITER_SYMBOLS[tok.delim].charAt(0)
                : TOKEN_KIND_NAMES[tok.kind];
        case 'close_delim':
            return tok.delim
                ? DELIMITER_SYMBOLS[tok.delim].charAt(1)
                : TOKEN_KIND_NAMES[tok.kind];
        case 'unknown':
            return tok.value;
        case undefined:
            throw Error('undefined token kind');
        default:
            return TOKEN_KIND_NAMES[tok.kind];
    }
}
