/// <reference types="../../../../CTAutocomplete" />

import type { Element } from "../../lib/layout";
import { Button, Container, Icon, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import {
    ACCENT_WARN,
    COLOR_BUTTON_PRIMARY,
    COLOR_BUTTON_PRIMARY_HOVER,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
} from "../../lib/theme";
import { getMtimeMs } from "../../lib/java";
import { getHousingUuid } from "../../state";
import {
    cachedStatusForImportable,
    importableLinkStatusContextKey,
} from "../../cache-status";
import { canonicalPath } from "../../parsing/parses";
import {
    houseLockPathForImportJson,
    readHouseLock,
} from "../../../importCache/houseLock";
import { houseLockCurrentEntryFor } from "../../../importCache/acceptHouseLock";
import { confirmAcceptProjectLock } from "./acceptHouseLock";
import { ROW_BG, ROW_HOVER_BG, bumpTreeRevision, type ResultImport } from "./rowModel";

// "Lock is ahead of cache": a teammate imported and pushed house.lock.json,
// so the lock describes the project as it is on disk while this machine's
// Knowledge cache still shows those entries as changed. The banner under the
// project row offers the existing "Sync cache from lock" flow instead of
// leaving the user to notice a wall of changed dots.
//
// Counted entries are exactly the ones acceptHouseLockAsCurrent would copy
// into the cache (lock hash == project hash, dependencies match, ITEM blob
// cached) whose cache status is still modified/unknown. The count is memoized
// per project on parse identity, the cache status context and the lock's
// mtime; the mtime is polled once a second through the tree's status
// fingerprint so a `git pull` shows up without a reload.

export type LockBannerState = { count: number; lockMtime: number };

type Evaluated = {
    parse: object;
    statusKey: string;
    lockMtime: number;
    state: LockBannerState | null;
};

const LOCK_POLL_MS = 1000;

const evaluatedByProject = new Map<string, Evaluated>();
const lockMtimeByProject = new Map<string, number>();
const dismissedByProject = new Map<string, number>();
let revision = 0;
let lastPollAt = 0;

export function getLockBannerRevision(): number {
    const now = Date.now();
    if (now - lastPollAt >= LOCK_POLL_MS) {
        lastPollAt = now;
        lockMtimeByProject.forEach((mtime, key) => {
            const next = getMtimeMs(houseLockPathForImportJson(key));
            if (next === mtime) return;
            lockMtimeByProject.set(key, next);
            revision++;
        });
    }
    return revision;
}

function evaluate(
    r: ResultImport,
    housingUuid: string,
    lockMtime: number
): LockBannerState | null {
    if (r.parse === null) return null;
    const lock = readHouseLock(r.fullPath);
    if (lock === null || lock.houseUuid !== housingUuid) return null;
    let count = 0;
    const importables = r.parse.value;
    for (let i = 0; i < importables.length; i++) {
        const imp = importables[i];
        if (houseLockCurrentEntryFor(lock, housingUuid, imp) === null) continue;
        const status = cachedStatusForImportable(imp);
        if (status === "modified" || status === "unknown") count++;
    }
    return count === 0 ? null : { count, lockMtime };
}

export function lockBannerFor(r: ResultImport): LockBannerState | null {
    if (r.parse === null) return null;
    const bound = r.parse.importJson.houseUuid;
    const current = getHousingUuid();
    if (bound === null || current === null || bound !== current) return null;
    const key = canonicalPath(r.fullPath);
    let lockMtime = lockMtimeByProject.get(key);
    if (lockMtime === undefined) {
        lockMtime = getMtimeMs(houseLockPathForImportJson(key));
        lockMtimeByProject.set(key, lockMtime);
    }
    if (lockMtime === 0) return null;
    if (dismissedByProject.get(key) === lockMtime) return null;
    const statusKey = importableLinkStatusContextKey();
    const cached = evaluatedByProject.get(key);
    if (
        cached !== undefined &&
        cached.parse === r.parse &&
        cached.statusKey === statusKey &&
        cached.lockMtime === lockMtime
    ) {
        return cached.state;
    }
    const state = evaluate(r, current, lockMtime);
    evaluatedByProject.set(key, { parse: r.parse, statusKey, lockMtime, state });
    return state;
}

function dismissLockBanner(r: ResultImport): void {
    const key = canonicalPath(r.fullPath);
    const lockMtime = lockMtimeByProject.get(key);
    if (lockMtime === undefined) return;
    dismissedByProject.set(key, lockMtime);
    revision++;
    bumpTreeRevision();
}

function slot(w: number): Element {
    return Container({
        style: { width: { kind: "px", value: w }, height: { kind: "grow" } },
        children: [],
    });
}

export function lockBannerRow(r: ResultImport): Element {
    const count = (): number => lockBannerFor(r)?.count ?? 0;
    const tooltip = (): string => {
        const n = count();
        return `${n} entr${n === 1 ? "y was" : "ies were"} imported elsewhere; this machine's cache still shows ${n === 1 ? "it" : "them"} as changed`;
    };
    return Container({
        style: {
            direction: "row",
            padding: { side: "right", value: 6 },
            gap: 0,
            align: "center",
            height: { kind: "px", value: 18 },
            background: ROW_BG,
        },
        children: [
            Container({
                style: {
                    width: { kind: "px", value: 2 },
                    height: { kind: "grow" },
                    background: ACCENT_WARN,
                },
                children: [],
            }),
            slot(5),
            Icon({
                name: Icons.databaseBackup,
                color: ACCENT_WARN,
                style: { width: { kind: "px", value: 9 }, height: { kind: "px", value: 9 } },
            }),
            slot(4),
            Text({
                text: () => `Lock is ahead of cache (${count()})`,
                color: ACCENT_WARN,
                truncate: true,
                tooltip,
                tooltipColor: ACCENT_WARN,
                style: { width: { kind: "grow" } },
            }),
            slot(4),
            Button({
                text: "Sync",
                tooltip: "Sync cache from house.lock.json",
                style: {
                    height: { kind: "px", value: 14 },
                    background: COLOR_BUTTON_PRIMARY,
                    hoverBackground: COLOR_BUTTON_PRIMARY_HOVER,
                },
                onClick: (_rect, info) => {
                    if (info.button !== 0 || info.isDoubleClickSecond) return;
                    confirmAcceptProjectLock(r.fullPath);
                },
            }),
            slot(2),
            Button({
                style: {
                    width: { kind: "px", value: 16 },
                    height: { kind: "grow" },
                    padding: 0,
                    background: 0x00000000,
                    hoverBackground: ROW_HOVER_BG,
                },
                tooltip: "Dismiss until the lock changes again",
                tooltipColor: COLOR_TEXT_DIM,
                onClick: (_rect, info) => {
                    if (info.button !== 0 || info.isDoubleClickSecond) return;
                    dismissLockBanner(r);
                },
                children: [
                    Icon({
                        name: Icons.x,
                        color: COLOR_TEXT_FAINT,
                        style: {
                            width: { kind: "px", value: 9 },
                            height: { kind: "px", value: 9 },
                        },
                    }),
                ],
            }),
        ],
    });
}
