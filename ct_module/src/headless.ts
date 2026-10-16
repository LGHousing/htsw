// Entry for HTSW without a player: imports, exports, diffs and the queue,
// driven by /htsw commands and the status bridge. Leaves out the overlay,
// workspace restore, auto-update, session heartbeat and the client-only
// commands in slashCommands/client.ts.
import "promise-polyfill/src/polyfill";
import "./polyfills/promiseSyncDrain";
import "./injectLong";
import "./injectHousingDecimal";
import "./tasks/manager";

import { registerSlashCommands } from "./slashCommands";
import { initChatLiveness } from "./importCache/chatLiveness";
import { initHousingLifecycle } from "./runtime/housingLifecycle";
import { initStatusBridge } from "./bridge/runtime";

export {
    publishProject,
    restoreProjectPublication,
    installProjectPublication,
} from "./project/publication";
export { installVerifiedCacheEntry } from "./importCache/cache";

initStatusBridge();
initChatLiveness();
registerSlashCommands();
initHousingLifecycle();
