// Compile-time check that ct_module implements the importer's client modules
// (importer/src/platform.ts) with compatible exports. Types only; nothing
// imports this file.
import type * as declaredPlatform from "@htsw/importer/platform";
import type * as platform from "./importerPlatform";
import type * as declared_capture from "@htsw/importer/housingSync/items/capture";
import type * as capture from "./housingSync/items/capture";
import type * as declared_heldItem from "@htsw/importer/housingSync/items/heldItem";
import type * as heldItem from "./housingSync/items/heldItem";
import type * as declared_itemPicker from "@htsw/importer/housingSync/items/itemPicker";
import type * as itemPicker from "./housingSync/items/itemPicker";
import type * as declared_playerInventory from "@htsw/importer/housingSync/items/playerInventory";
import type * as playerInventory from "./housingSync/items/playerInventory";
import type * as declared_menuInput from "@htsw/importer/housingSync/menus/menuInput";
import type * as menuInput from "./housingSync/menus/menuInput";
import type * as declared_sideEffects from "@htsw/importer/housingSync/sideEffects";
import type * as sideEffects from "./housingSync/sideEffects";
import type * as declared_icon from "@htsw/importer/importables/functions/icon";
import type * as icon from "./importables/functions/icon";
import type * as declared_htswPath from "@htsw/importer/project/htswPath";
import type * as htswPath from "./project/htswPath";
import type * as declared_projectFs from "@htsw/importer/project/projectFs";
import type * as projectFs from "./project/projectFs";
import type * as declared_realPath from "@htsw/importer/runtime/parsing/realPath";
import type * as realPath from "./runtime/parsing/realPath";
import type * as declared_importFailureLog from "@htsw/importer/runtimeDebug/importFailureLog";
import type * as importFailureLog from "./runtimeDebug/importFailureLog";
import type * as declared_importFailureUpload from "@htsw/importer/runtimeDebug/importFailureUpload";
import type * as importFailureUpload from "./runtimeDebug/importFailureUpload";
import type * as declared_slots from "@htsw/importer/tasks/specifics/slots";
import type * as slots from "./tasks/specifics/slots";
import type * as declared_waitFor from "@htsw/importer/tasks/specifics/waitFor";
import type * as waitFor from "./tasks/specifics/waitFor";
import type * as declared_jsonl from "@htsw/importer/trace/jsonl";
import type * as jsonl from "./trace/jsonl";
import type * as declared_fileLoaders from "@htsw/importer/utils/fileLoaders";
import type * as fileLoaders from "./utils/fileLoaders";
import type * as declared_filesystem from "@htsw/importer/utils/filesystem";
import type * as filesystem from "./utils/filesystem";
import type * as declared_itemLore from "@htsw/importer/utils/itemLore";
import type * as itemLore from "./utils/itemLore";
import type * as declared_mainThread from "@htsw/importer/utils/mainThread";
import type * as mainThread from "./utils/mainThread";
import type * as declared_nbt from "@htsw/importer/utils/nbt";
import type * as nbt from "./utils/nbt";
import type * as declared_packets from "@htsw/importer/utils/packets";
import type * as packets from "./utils/packets";

// Parameters compare both ways, as for methods: an importer Item is the
// client's own item at runtime, but neither type covers the other.
type Loose<T> = T extends (...args: infer A) => infer R
    ? { method(...args: A): R }["method"]
    : T;
type Implements<Client, Declared> = {
    [K in keyof Declared]: K extends keyof Client
        ? Loose<Client[K]> extends Loose<Declared[K]>
            ? true
            : K
        : K;
}[keyof Declared];
type Check<T extends true> = T;

export type ImporterClientConformance = [
    Check<Implements<typeof platform, typeof declaredPlatform>>,
    Check<Implements<typeof capture, typeof declared_capture>>,
    Check<Implements<typeof heldItem, typeof declared_heldItem>>,
    Check<Implements<typeof itemPicker, typeof declared_itemPicker>>,
    Check<Implements<typeof playerInventory, typeof declared_playerInventory>>,
    Check<Implements<typeof menuInput, typeof declared_menuInput>>,
    Check<Implements<typeof sideEffects, typeof declared_sideEffects>>,
    Check<Implements<typeof icon, typeof declared_icon>>,
    Check<Implements<typeof htswPath, typeof declared_htswPath>>,
    Check<Implements<typeof projectFs, typeof declared_projectFs>>,
    Check<Implements<typeof realPath, typeof declared_realPath>>,
    Check<Implements<typeof importFailureLog, typeof declared_importFailureLog>>,
    Check<Implements<typeof importFailureUpload, typeof declared_importFailureUpload>>,
    Check<Implements<typeof slots, typeof declared_slots>>,
    Check<Implements<typeof waitFor, typeof declared_waitFor>>,
    Check<Implements<typeof jsonl, typeof declared_jsonl>>,
    Check<Implements<typeof fileLoaders, typeof declared_fileLoaders>>,
    Check<Implements<typeof filesystem, typeof declared_filesystem>>,
    Check<Implements<typeof itemLore, typeof declared_itemLore>>,
    Check<Implements<typeof mainThread, typeof declared_mainThread>>,
    Check<Implements<typeof nbt, typeof declared_nbt>>,
    Check<Implements<typeof packets, typeof declared_packets>>,
];
