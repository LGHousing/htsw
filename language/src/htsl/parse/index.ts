import { Lexer } from "./lexer";
import { Parser } from "./parser";
import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import type { Action } from "../../types";
import { check as checkTypeflow } from "../typecheck/check";
import { TyCtxt } from "../typecheck/context";

type CachedHtslParse = {
    mtime: number;
    actions: Action[];
};

const htslCache = new Map<string, CachedHtslParse>();

export function clearHtslCache(): void {
    htslCache.clear();
}

/**
 * Optional mtime provider injected by the host. When set, the cache
 * validates by mtime (one stat call) instead of reading + hashing.
 */
let mtimeProvider: ((path: string) => number) | null = null;

export function setHtslCacheMtimeProvider(fn: ((path: string) => number) | null): void {
    mtimeProvider = fn;
}

export function parseHtsl(gcx: GlobalCtxt, path: string): Action[] {
    try {
        const timing = gcx.htslTiming;

        if (mtimeProvider !== null) {
            const t0 = timing ? Date.now() : 0;
            const mtime = mtimeProvider(path);
            const cached = htslCache.get(path);
            if (cached !== undefined && mtime !== 0 && cached.mtime === mtime) {
                if (timing) {
                    timing.fileCount++;
                    timing.cacheHits++;
                    timing.fileReadMs += Date.now() - t0;
                }
                return cached.actions;
            }
        }

        const t0 = timing ? Date.now() : 0;
        const file = gcx.sourceMap.getFile(path);
        const t1 = timing ? Date.now() : 0;

        const lexer = new Lexer(file);
        const parser = new Parser(gcx, lexer);
        const actions = parser.parseCompletely();
        const t2 = timing ? Date.now() : 0;
        const tcx = TyCtxt.fromGlobalCtxt(gcx);
        checkTypeflow(tcx, actions);
        const t3 = timing ? Date.now() : 0;

        const mtime = mtimeProvider !== null ? mtimeProvider(path) : 0;
        htslCache.set(path, { mtime, actions });

        if (timing) {
            timing.fileCount++;
            timing.fileReadMs += t1 - t0;
            timing.lexParseMs += t2 - t1;
            timing.typeflowMs += t3 - t2;
        }
        return actions;
    } catch (e) {
        htslCache.delete(path);
        if (e instanceof Error) {
            gcx.addDiagnostic(Diagnostic.bugFromError(e));
        } else {
            gcx.addDiagnostic(Diagnostic.bug(`An unknown error occurred parsing ${path}`));
        }
        return [];
    }
}
