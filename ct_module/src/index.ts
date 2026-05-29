import "promise-polyfill/src/polyfill";
import "./polyfills/promiseSyncDrain";
import "./injectLong";
import "./tasks/manager";

import { registerCommands } from "./commands";
import { registerExportCommands } from "./exporter";
import { initMcpBridge } from "./mcp/bridge";
import { initHtswGui } from "./gui/overlay";
import { registerImportSoundCancel } from "./importer/sideEffects";
import { htsl } from "htsw";
import { getMtimeMs } from "./gui/lib/java";
import { backgroundPreloadIcons } from "./gui/lib/render";
import { loadPersistedCostOverrides } from "./importer/progress/costs";

htsl.setHtslCacheMtimeProvider(getMtimeMs);
loadPersistedCostOverrides();

registerCommands();
registerExportCommands();
initMcpBridge();
initHtswGui();
registerImportSoundCancel();
backgroundPreloadIcons();
