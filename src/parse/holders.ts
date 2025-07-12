import type { Parser } from './parser';
import type { IrActionHolder } from '../ir';
import { Span } from '../span';
import { error } from '../diagnostic';

export function parseHolder(p: Parser): IrActionHolder {
    if (p.eat({ kind: 'ident', value: 'goto' })) {
        if (p.eatIdent('function')) {
            return parseHolderFunction(p);
        }

        throw error('Expected action holder type (function, event)', p.token.span);
    }

    return parseHolderUnknown(p);
}

function parseHolderRecovering<T extends IrActionHolder['type']>(
    p: Parser,
    type: T,
    parser: (action: IrActionHolder & { type: T }) => void
): IrActionHolder & { type: T } {
    const start = p.prev.span.start;
    const holder = { type, kwSpan: p.prev.span } as IrActionHolder & { type: T };
    p.parseRecovering(['eol'], () => {
        parser(holder);
    });
    holder.span = new Span(start, p.prev.span.end);
    return holder;
}

function parseHolderUnknown(p: Parser): IrActionHolder {
    return parseHolderRecovering(p, 'UNKNOWN', (holder) => {
        holder.actions = p.spanned(p.parseActions);
    });
}

function parseHolderFunction(p: Parser): IrActionHolder {
    return parseHolderRecovering(p, 'FUNCTION', (holder) => {
        holder.name = p.spanned(p.parseName);
        holder.actions = p.spanned(p.parseActions);
    });
}
