import { parseFromString } from './parse';
import { unwrapIr } from './ir';
import type { Diagnostic } from './diagnostic';
import type { ActionHolder } from 'housing-common';

export * from './span';
export * from './ir';
export * from './source';
export * from './diagnostic';

export * as parse from './parse';
export * as codegen from './codegen';
export * as helpers from './helpers';

export function actions(src: string): ActionHolder[] {
    return parseFromString(src).holders.map(unwrapIr<ActionHolder>);
}

export function diagnostics(src: string): Diagnostic[] {
    return parseFromString(src).diagnostics;
}