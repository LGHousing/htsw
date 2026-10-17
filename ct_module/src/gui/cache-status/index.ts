import { statusForImportableBlocking } from "../../importCache/importableStatus";
export { cachedStatusForImportable } from "../../importCache/importableStatus";
import type { CacheState } from "../../importCache/status";
import { findFileTarget } from "../code-view/sourceDiff";

export { linkStatusIcon, type LinkStatusKey } from "./linkStatus";
export {
    cachedImportableLinkStatus,
    importableLinkStatusContextKey,
} from "./importableLinkStatus";

export const STATUS_COLOR: { [k in CacheState]: number } = {
    current: 0xff5cb85c | 0, // green
    modified: 0xffe5bc4b | 0, // yellow
    unknown: 0xffe85c5c | 0, // red
};

export const STATUS_LABEL: { [k in CacheState]: string } = {
    current: "current",
    modified: "modified",
    unknown: "unknown",
};

export function statusForFile(
    filePath: string,
    importJsonPath?: string | null
): CacheState | null {
    const target = findFileTarget(filePath, importJsonPath);
    if (target === null) return null;
    return statusForImportableBlocking(target.importable);
}
