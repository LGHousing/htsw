import type { Importable } from "htsw/types";

import { runOnMainThread } from "../utils/mainThread";
import { importableHash } from "./hash";
import { platform } from "../platform";

const hashByImportable = new WeakMap<object, string>();
let importableHashRevision = 0;

export function memoizedImportableHash(importable: Importable): string {
    const cached = hashByImportable.get(importable);
    if (cached !== undefined) return cached;
    const hash = importableHash(importable);
    hashByImportable.set(importable, hash);
    return hash;
}

export function rememberImportableHash(importable: Importable, hash: string): void {
    hashByImportable.set(importable, hash);
}

export function seedImportableHash(importable: Importable, hash: string): void {
    rememberImportableHash(importable, hash);
    importableHashRevision++;
}

export function getImportableHashRevision(): number {
    return importableHashRevision;
}

export function warmImportableHashesOffThread(
    importables: readonly Importable[],
    onComplete: () => void
): void {
    const pending: Importable[] = [];
    for (let i = 0; i < importables.length; i++) {
        if (!hashByImportable.has(importables[i])) pending.push(importables[i]);
    }
    if (pending.length === 0) {
        onComplete();
        return;
    }

    try {
        platform().startDaemonThread(function () {
            const hashes: string[] = [];
            try {
                for (let i = 0; i < pending.length; i++) {
                    hashes.push(importableHash(pending[i]));
                }
            } catch (_error) {
                runOnMainThread(onComplete);
                return;
            }
            runOnMainThread(() => {
                for (let i = 0; i < pending.length; i++) {
                    if (!hashByImportable.has(pending[i])) {
                        rememberImportableHash(pending[i], hashes[i]);
                    }
                }
                onComplete();
            });
        });
    } catch (_error) {
        onComplete();
    }
}
