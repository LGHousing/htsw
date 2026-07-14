import * as htsw from "htsw";
import {
    applyItemEditsToTag,
    buildItemTag,
    customItemTagsFromTag,
    MAX_HOUSING_ENCHANTMENT_LEVEL,
} from "htsw-editor-common/item/buildItemNbt";
import { ensureMinecraftFont, renderItemPreviewInto, type ItemView } from "../mcItem/render";
import { scrollPastNumberInputs } from "../numberInputWheel";
import type {
    ImportTarget,
    ItemEditorForm,
    ItemEditorFromHostMessage,
    ItemEditorToHostMessage,
} from "../protocol";

type VsCodeApi = ReturnType<typeof acquireVsCodeApi>;

/** Payload that opens the editor on an existing `.snbt` (see the host's
 * `openItemInEditor`). The shell hands it to {@link mountItemEditor}. */
export type ItemEditorLoad = Extract<ItemEditorFromHostMessage, { type: "loadItem" }>;

type MinecraftItem = {
    id: number;
    displayName: string;
    name: string;
    stackSize?: number;
    variations?: readonly {
        metadata: number;
        displayName: string;
    }[];
};

type FilteredItem = {
    item: MinecraftItem;
    metadata: number | null;
    label: string;
};

type CustomTagInput = {
    name: string;
    value: string;
};

type State = {
    itemSearch: string;
    itemName: string;
    metadata: number | null;
    count: number;
    displayName: string;
    lore: string[];
    enchants: { name: string; level: number }[];
    customTags: CustomTagInput[];
    entryName: string;
    importJsonPath: string;
    targets: ImportTarget[];
    createLeftClickActions: boolean;
    createRightClickActions: boolean;
    status: { kind: "idle" | "ok" | "error"; text: string };
    /** Set when editing an existing `.snbt`: the file to save back to, a label
     * for the header, and the original parsed tag (so unmanaged NBT survives). */
    editPath?: string;
    editLabel?: string;
    originalTag?: unknown;
};

const ITEMS = htsw.types.MINECRAFT_ITEMS as readonly MinecraftItem[];
const ENCHANTMENTS = htsw.types.ENCHANTMENTS;

export function mountItemEditor(
    app: HTMLElement,
    vscode: VsCodeApi,
    load?: ItemEditorLoad,
    initialScroll: Record<string, number> = {},
): () => void {
    const bindInput = (id: string, handler: (value: string) => void) => bindInputIn(app, id, handler);
    const bindSelect = (id: string, handler: (value: string) => void) => bindSelectIn(app, id, handler);
    const bindCheckbox = (id: string, handler: (value: boolean) => void) => bindCheckboxIn(app, id, handler);
    const bindClick = (id: string, handler: () => void) => bindClickIn(app, id, handler);
    ensureMinecraftFont();
    scrollPastNumberInputs();
    const firstItem = ITEMS[0];
    const loadedName = load ? load.item.itemId.replace(/^minecraft:/, "") : undefined;
    const state: State = {
        itemSearch: "",
        itemName: loadedName ?? firstItem?.name ?? "stone",
        metadata: load ? load.item.metadata : firstMetadata(firstItem),
        count: load ? Math.max(1, load.item.count) : 1,
        displayName: load ? load.item.displayName : "",
        lore: load && load.item.lore.length > 0 ? [...load.item.lore] : [""],
        enchants: load ? load.item.enchants.map((enchant) => ({ ...enchant })) : [],
        customTags: load ? customTagInputsFromTag(load.tag) : [],
        entryName: firstItem?.displayName ?? "Stone",
        importJsonPath: "",
        targets: [],
        createLeftClickActions: false,
        createRightClickActions: false,
        status: { kind: "idle", text: "" },
        editPath: load?.snbtPath,
        editLabel: load?.label,
        originalTag: load?.tag,
    };

    const onMessage = (event: MessageEvent<ItemEditorFromHostMessage>) => {
        const message = event.data;
        if (message.type === "loadItem") {
            applyItemLoad(state, message);
            render();
            return;
        }
        if (message.type === "importTargets") {
            state.targets = message.targets;
            if (!state.importJsonPath && message.targets.length > 0) {
                state.importJsonPath = message.targets[0].fsPath;
            }
            render();
            return;
        }

        if (message.type === "submitResult") {
            state.status = message.ok
                ? { kind: "ok", text: "Item added to the project." }
                : { kind: "error", text: message.error };
            renderStatus();
        }

        if (message.type === "saveResult") {
            state.status = message.ok
                ? { kind: "ok", text: "Saved." }
                : { kind: "error", text: message.error };
            renderStatus();
        }
    };
    window.addEventListener("message", onMessage);

    render();
    post(vscode, { type: "requestImportTargets" });
    return () => window.removeEventListener("message", onMessage);

    function render(): void {
        const scroll = {
            page: app.querySelector<HTMLElement>(":scope > .app")?.scrollTop ?? initialScroll.page ?? 0,
            form: app.querySelector<HTMLElement>(".form-panel")?.scrollTop ?? initialScroll.form ?? 0,
            preview: app.querySelector<HTMLElement>(".preview-panel")?.scrollTop ?? initialScroll.preview ?? 0,
        };
        initialScroll = {};
        const item = currentItem(state);
        const filteredItems = ensureSelectedItemOption(filterItems(state.itemSearch), state);
        const maxCount = item?.stackSize ?? 64;
        if (state.count > maxCount) state.count = maxCount;

        app.innerHTML = `
            <div class="app">
                <div class="panel form-panel">
                    <div class="section">
                        <h2>Item</h2>
                        <label>
                            <span class="label-text">Search</span>
                            <input id="itemSearch" value="${escapeAttr(state.itemSearch)}" placeholder="stone, sword, wool">
                        </label>
                        <label>
                            <span class="label-text">Type</span>
                            <select id="itemName">
                                ${filteredItems.map((entry) => option(itemOptionValue(entry), entry.label, entry.item.name === state.itemName && entry.metadata === state.metadata)).join("")}
                            </select>
                        </label>
                        ${variantSelect(item, state.metadata)}
                        <div class="two">
                            <label>
                                <span class="label-text">Count</span>
                                <input id="count" type="number" min="1" max="${maxCount}" value="${state.count}">
                            </label>
                            <label>
                                <span class="label-text">Max</span>
                                <input value="${maxCount}" disabled>
                            </label>
                        </div>
                    </div>

                    <div class="section">
                        <h2>Display</h2>
                        <label>
                            <span class="label-text">Name</span>
                            <input id="displayName" value="${escapeAttr(state.displayName)}" placeholder="&aLauncher">
                        </label>
                        <label>
                            <span class="label-text">Lore</span>
                        </label>
                        <div id="loreRows">
                            ${state.lore.map((line, index) => loreRow(line, index)).join("")}
                        </div>
                        <button id="addLore" class="secondary" type="button">Add Lore</button>
                    </div>

                    <div class="section">
                        <h2>Enchantments</h2>
                        <div id="enchantRows">
                            ${state.enchants.map((enchant, index) => enchantRow(enchant, index)).join("")}
                        </div>
                        <button id="addEnchant" class="secondary" type="button">Add Enchant</button>
                    </div>

                    <div class="section">
                        <h2>Custom NBT</h2>
                        <p class="section-hint">Added inside <code>tag</code>. Values use SNBT, for example <code>ItemModel</code> with <code>"minecraft:netherite_spear"</code>.</p>
                        <div class="custom-tag-headings" aria-hidden="true">
                            <span>Tag name</span>
                            <span>SNBT value</span>
                        </div>
                        <div id="customTagRows">
                            ${state.customTags.map((customTag, index) => customTagRow(customTag, index)).join("")}
                        </div>
                        <button id="addCustomTag" class="secondary" type="button">Add Tag</button>
                    </div>

                    ${projectSection(state)}
                </div>

                <div class="panel preview-panel">
                    <div class="section">
                        <h2>Item Preview</h2>
                        <div id="itemPreview" class="tooltip-stage"></div>
                    </div>
                    <div class="section">
                        <h2>SNBT</h2>
                        <pre id="snbtPreview"></pre>
                    </div>
                </div>
            </div>
        `;

        bindControls(vscode);
        updateCustomTagFeedback();
        updateFormattedPreviews();
        updateSnbtPreview();
        renderStatus();
        const page = app.querySelector<HTMLElement>(":scope > .app");
        const form = app.querySelector<HTMLElement>(".form-panel");
        const preview = app.querySelector<HTMLElement>(".preview-panel");
        if (page) page.scrollTop = scroll.page;
        if (form) form.scrollTop = scroll.form;
        if (preview) preview.scrollTop = scroll.preview;
    }

    function bindControls(vscode: VsCodeApi): void {
        bindInput("itemSearch", (value) => {
            state.itemSearch = value;
            updateItemSelectOptions();
        });
        bindSelect("itemName", (value) => {
            const previous = currentItem(state);
            const syncEntryName =
                state.entryName.trim().length === 0 ||
                state.entryName === (previous?.displayName ?? previous?.name);
            const selected = parseItemOptionValue(value);
            const item = itemByName(selected.itemName);
            state.itemName = selected.itemName;
            state.metadata = selected.metadata ?? firstMetadata(item);
            if (syncEntryName) state.entryName = selected.label ?? item?.displayName ?? selected.itemName;
            render();
        });
        bindSelect("metadata", (value) => {
            state.metadata = value === "" ? null : Number(value);
            updateSnbtPreview();
        });
        bindInput("count", (value) => {
            state.count = clamp(Number(value), 1, currentItem(state)?.stackSize ?? 64);
            updateFormattedPreviews();
            updateSnbtPreview();
        });
        bindInput("displayName", (value) => {
            state.displayName = value;
            updateFormattedPreviews();
            updateSnbtPreview();
        });
        bindInput("entryName", (value) => {
            state.entryName = value;
            updateActionState();
        });
        bindSelect("importJsonPath", (value) => {
            state.importJsonPath = value;
            updateActionState();
        });
        bindCheckbox("createLeftClickActions", (value) => {
            state.createLeftClickActions = value;
        });
        bindCheckbox("createRightClickActions", (value) => {
            state.createRightClickActions = value;
        });

        for (let i = 0; i < state.lore.length; i++) {
            bindInput(`lore-${i}`, (value) => {
                state.lore[i] = value;
                updateFormattedPreviews();
                updateSnbtPreview();
            });
            bindClick(`lore-up-${i}`, () => {
                move(state.lore, i, i - 1);
                render();
            });
            bindClick(`lore-down-${i}`, () => {
                move(state.lore, i, i + 1);
                render();
            });
            bindClick(`lore-remove-${i}`, () => {
                state.lore.splice(i, 1);
                if (state.lore.length === 0) state.lore.push("");
                render();
            });
        }

        for (let i = 0; i < state.enchants.length; i++) {
            bindSelect(`enchant-name-${i}`, (value) => {
                state.enchants[i].name = value;
                updateFormattedPreviews();
                updateSnbtPreview();
            });
            bindInput(`enchant-level-${i}`, (value) => {
                const enteredLevel = Number(value);
                state.enchants[i].level = clamp(enteredLevel, 1, MAX_HOUSING_ENCHANTMENT_LEVEL);
                if (enteredLevel > MAX_HOUSING_ENCHANTMENT_LEVEL) {
                    const input = app.querySelector(`#enchant-level-${i}`) as HTMLInputElement | null;
                    if (input) input.value = String(MAX_HOUSING_ENCHANTMENT_LEVEL);
                }
                updateFormattedPreviews();
                updateSnbtPreview();
            });
            bindClick(`enchant-remove-${i}`, () => {
                state.enchants.splice(i, 1);
                render();
            });
        }

        for (let i = 0; i < state.customTags.length; i++) {
            bindInput(`custom-tag-name-${i}`, (value) => {
                state.customTags[i].name = value;
                updateCustomTagFeedback();
                updateSnbtPreview();
            });
            bindInput(`custom-tag-value-${i}`, (value) => {
                state.customTags[i].value = value;
                updateCustomTagFeedback();
                updateSnbtPreview();
            });
            bindClick(`custom-tag-remove-${i}`, () => {
                state.customTags.splice(i, 1);
                render();
            });
        }

        bindClick("addLore", () => {
            state.lore.push("");
            render();
        });
        bindClick("addEnchant", () => {
            state.enchants.push({ name: ENCHANTMENTS[0], level: 1 });
            render();
        });
        bindClick("addCustomTag", () => {
            const index = state.customTags.length;
            state.customTags.push({ name: "", value: "" });
            render();
            app.querySelector<HTMLInputElement>(`#custom-tag-name-${index}`)?.focus();
        });
        bindClick("generate", () => {
            if (!canSubmit(state)) return;
            state.status = { kind: "idle", text: "Generating..." };
            renderStatus();
            post(vscode, { type: "submitItem", form: toForm(state) });
        });
        bindClick("save", () => {
            if (state.editPath === undefined || !customTagsAreValid(state.customTags)) return;
            state.status = { kind: "idle", text: "Saving..." };
            renderStatus();
            post(vscode, { type: "saveItem", snbtPath: state.editPath, tag: currentItemTag(state) });
        });
    }

    function updateSnbtPreview(): void {
        const preview = app.querySelector("#snbtPreview");
        if (!preview) return;
        try {
            preview.textContent = htsw.nbt.printSnbt(currentItemTag(state), {
                pretty: true,
                indent: "    ",
            });
        } catch (err) {
            preview.textContent = err instanceof Error ? err.message : String(err);
        }
    }

    function updateFormattedPreviews(): void {
        renderItemPreview(app, state);
    }

    function updateItemSelectOptions(): void {
        const select = app.querySelector("#itemName") as HTMLSelectElement | null;
        if (!select) return;
        const filteredItems = ensureSelectedItemOption(filterItems(state.itemSearch), state);
        select.innerHTML = filteredItems
            .map((entry) => option(
                itemOptionValue(entry),
                entry.label,
                entry.item.name === state.itemName && entry.metadata === state.metadata
            ))
            .join("");
    }

    function updateActionState(): void {
        const generate = app.querySelector("#generate") as HTMLButtonElement | null;
        if (generate) generate.disabled = !canSubmit(state);
        const save = app.querySelector("#save") as HTMLButtonElement | null;
        if (save) save.disabled = !customTagsAreValid(state.customTags);
    }

    function updateCustomTagFeedback(): void {
        const errors = customTagErrors(state.customTags);
        for (let i = 0; i < errors.length; i++) {
            const row = app.querySelector<HTMLElement>(`#custom-tag-row-${i}`);
            const error = app.querySelector<HTMLElement>(`#custom-tag-error-${i}`);
            const invalid = errors[i].length > 0;
            row?.classList.toggle("invalid", invalid);
            if (error) error.textContent = errors[i];
            app.querySelector<HTMLInputElement>(`#custom-tag-name-${i}`)
                ?.setAttribute("aria-invalid", String(invalid));
            app.querySelector<HTMLInputElement>(`#custom-tag-value-${i}`)
                ?.setAttribute("aria-invalid", String(invalid));
        }
        updateActionState();
    }

    function renderStatus(): void {
        const status = app.querySelector("#status");
        if (!status) return;
        status.className = `status ${state.status.kind === "idle" ? "" : state.status.kind}`;
        status.textContent = state.status.text;
    }
}

function applyItemLoad(state: State, load: ItemEditorLoad): void {
    state.itemSearch = "";
    state.itemName = load.item.itemId.replace(/^minecraft:/, "");
    state.metadata = load.item.metadata;
    state.count = Math.max(1, load.item.count);
    state.displayName = load.item.displayName;
    state.lore = load.item.lore.length > 0 ? [...load.item.lore] : [""];
    state.enchants = load.item.enchants.map((enchant) => ({ ...enchant }));
    state.customTags = customTagInputsFromTag(load.tag);
    state.status = { kind: "idle", text: "" };
    state.editPath = load.snbtPath;
    state.editLabel = load.label;
    state.originalTag = load.tag;
}

function toForm(state: State): ItemEditorForm {
    return {
        itemName: state.itemName,
        count: state.count,
        metadata: state.metadata,
        displayName: state.displayName,
        lore: trimTrailingEmptyLines(state.lore),
        enchants: state.enchants,
        customTags: parseCustomTags(state.customTags),
        entryName: state.entryName,
        importJsonPath: state.importJsonPath,
        createLeftClickActions: state.createLeftClickActions,
        createRightClickActions: state.createRightClickActions,
    };
}

// When editing an existing file, merge onto its original tag so keys the editor
// doesn't model (skull owners, hide flags, ...) survive the round-trip.
function currentItemTag(state: State) {
    if (state.editPath !== undefined && state.originalTag !== undefined) {
        return applyItemEditsToTag(
            state.originalTag as Parameters<typeof applyItemEditsToTag>[0],
            toForm(state),
        );
    }
    return buildItemTag(toForm(state));
}

function projectSection(state: State): string {
    if (state.editPath !== undefined) {
        return `
            <div class="section">
                <h2>Save</h2>
                <p class="label-text">Editing <code>${escapeHtml(state.editLabel ?? state.editPath)}</code>. Unmanaged top-level NBT is kept.</p>
                <button id="save" type="button" ${customTagsAreValid(state.customTags) ? "" : "disabled"}>Save</button>
                <div id="status" class="status"></div>
            </div>
        `;
    }
    return `
        <div class="section">
            <h2>Add to Project</h2>
            <label>
                <span class="label-text">Name in project</span>
                <input id="entryName" value="${escapeAttr(state.entryName)}" placeholder="Launcher">
            </label>
            <label>
                <span class="label-text">Add to import.json</span>
                <select id="importJsonPath">
                    ${state.targets.map((target) => option(target.fsPath, target.label, target.fsPath === state.importJsonPath)).join("")}
                </select>
            </label>
            <div class="checks">
                <label class="check">
                    <input id="createLeftClickActions" type="checkbox" ${state.createLeftClickActions ? "checked" : ""}>
                    <span>Create an empty actions file for left click</span>
                </label>
                <label class="check">
                    <input id="createRightClickActions" type="checkbox" ${state.createRightClickActions ? "checked" : ""}>
                    <span>Create an empty actions file for right click</span>
                </label>
            </div>
            <button id="generate" type="button" ${canSubmit(state) ? "" : "disabled"}>Add Item</button>
            <div id="status" class="status"></div>
        </div>
    `;
}

function trimTrailingEmptyLines(lines: readonly string[]): string[] {
    const out = [...lines];
    while (out.length > 0 && out[out.length - 1] === "") out.pop();
    return out;
}

function currentItem(state: State): MinecraftItem | undefined {
    return itemByName(state.itemName);
}

function itemByName(name: string): MinecraftItem | undefined {
    return ITEMS.find((item) => item.name === name);
}

function firstMetadata(item: MinecraftItem | undefined): number | null {
    return item?.variations?.[0]?.metadata ?? null;
}

function filterItems(query: string): FilteredItem[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        return ITEMS.slice(0, 180).map((item) => ({
            item,
            metadata: firstMetadata(item),
            label: item.displayName,
        }));
    }

    const terms = normalized.split(/\s+/).filter(Boolean);
    const matches: FilteredItem[] = [];
    for (const item of ITEMS) {
        const topHaystack = `${item.displayName} ${item.name}`.toLowerCase();
        if (terms.every((term) => topHaystack.includes(term))) {
            matches.push({ item, metadata: firstMetadata(item), label: item.displayName });
        }

        for (const variant of item.variations ?? []) {
            const variantHaystack = `${variant.displayName} ${item.displayName} ${item.name}`.toLowerCase();
            if (!terms.every((term) => variantHaystack.includes(term))) continue;
            matches.push({
                item,
                metadata: variant.metadata,
                label: variant.displayName === item.displayName
                    ? item.displayName
                    : `${variant.displayName} (${item.displayName})`,
            });
        }
    }

    const unique = new Map<string, FilteredItem>();
    for (const match of matches) {
        unique.set(itemOptionValue(match), match);
    }

    return [...unique.values()]
        .sort((left, right) => matchRank(left, normalized) - matchRank(right, normalized) ||
            left.label.localeCompare(right.label))
        .slice(0, 250);
}

function matchRank(entry: FilteredItem, query: string): number {
    const label = entry.label.toLowerCase();
    if (label === query) return 0;
    if (label.startsWith(query)) return 1;
    if (entry.item.name.startsWith(query)) return 2;
    return 3;
}

function itemOptionValue(entry: FilteredItem): string {
    return `${entry.item.name}|${entry.metadata ?? ""}|${entry.label}`;
}

function parseItemOptionValue(value: string): { itemName: string; metadata: number | null; label?: string } {
    const [itemName, metadata, label] = value.split("|");
    return {
        itemName,
        metadata: metadata === "" || metadata === undefined ? null : Number(metadata),
        label,
    };
}

function ensureSelectedItemOption(items: FilteredItem[], state: State): FilteredItem[] {
    if (items.some((entry) => entry.item.name === state.itemName && entry.metadata === state.metadata)) {
        return items;
    }
    const item = currentItem(state);
    if (!item) return items;
    return [{
        item,
        metadata: state.metadata,
        label: variantDisplayName(item, state.metadata) ?? item.displayName,
    }, ...items];
}

function variantDisplayName(item: MinecraftItem, metadata: number | null): string | undefined {
    if (metadata === null) return undefined;
    return item.variations?.find((variant) => variant.metadata === metadata)?.displayName;
}

function variantSelect(item: MinecraftItem | undefined, metadata: number | null): string {
    if (!item?.variations || item.variations.length === 0) return "";
    return `
        <label>
            <span class="label-text">Variant</span>
            <select id="metadata">
                ${item.variations.map((variant) => option(String(variant.metadata), variant.displayName, variant.metadata === metadata)).join("")}
            </select>
        </label>
    `;
}

function renderItemPreview(app: HTMLElement, state: State): void {
    const host = app.querySelector<HTMLElement>("#itemPreview");
    if (!host) return;
    renderItemPreviewInto(host, itemViewFromState(state));
}

function itemViewFromState(state: State): ItemView {
    return {
        itemName: state.itemName,
        metadata: state.metadata ?? 0,
        count: state.count,
        displayName: state.displayName,
        lore: trimTrailingEmptyLines(state.lore),
        enchants: state.enchants,
    };
}

function loreRow(line: string, index: number): string {
    return `
        <div class="row">
            <input id="lore-${index}" value="${escapeAttr(line)}" placeholder="&7Lore line">
            <div>
                <button id="lore-up-${index}" class="secondary icon" type="button" title="Move up">↑</button>
                <button id="lore-down-${index}" class="secondary icon" type="button" title="Move down">↓</button>
                <button id="lore-remove-${index}" class="secondary icon" type="button" title="Remove">×</button>
            </div>
        </div>
    `;
}

function enchantRow(enchant: { name: string; level: number }, index: number): string {
    return `
        <div class="enchant-row">
            <select id="enchant-name-${index}">
                ${ENCHANTMENTS.map((name) => option(name, name, name === enchant.name)).join("")}
            </select>
            <input id="enchant-level-${index}" type="number" min="1" max="${MAX_HOUSING_ENCHANTMENT_LEVEL}" value="${enchant.level}">
            <button id="enchant-remove-${index}" class="secondary icon" type="button" title="Remove">×</button>
        </div>
    `;
}

function customTagRow(customTag: CustomTagInput, index: number): string {
    return `
        <div id="custom-tag-row-${index}" class="custom-tag-row">
            <div class="custom-tag-fields">
                <input id="custom-tag-name-${index}" value="${escapeAttr(customTag.name)}" placeholder="ItemModel" aria-label="Tag name" spellcheck="false">
                <input id="custom-tag-value-${index}" value="${escapeAttr(customTag.value)}" placeholder="&quot;minecraft:netherite_spear&quot;" aria-label="SNBT value" spellcheck="false">
                <button id="custom-tag-remove-${index}" class="secondary icon" type="button" title="Remove tag">×</button>
            </div>
            <div id="custom-tag-error-${index}" class="field-error" role="status"></div>
        </div>
    `;
}

function customTagInputsFromTag(tag: unknown): CustomTagInput[] {
    return customItemTagsFromTag(tag as Parameters<typeof customItemTagsFromTag>[0]).map((customTag) => ({
        name: customTag.name,
        value: htsw.nbt.printSnbt(customTag.value),
    }));
}

function parseCustomTags(customTags: readonly CustomTagInput[]): ItemEditorForm["customTags"] {
    return customTags.map((customTag) => ({
        name: customTag.name.trim(),
        value: htsw.nbt.parseSnbtText(customTag.value.trim()),
    }));
}

function customTagsAreValid(customTags: readonly CustomTagInput[]): boolean {
    return customTagErrors(customTags).every((error) => error.length === 0);
}

function customTagErrors(customTags: readonly CustomTagInput[]): string[] {
    const names = customTags.map((customTag) => customTag.name.trim());
    return customTags.map((customTag, index) => {
        const name = names[index];
        if (!name) return "Enter a tag name.";
        if (name === "display" || name === "ench") {
            return `Use the editor's ${name === "display" ? "Display" : "Enchantments"} section for this tag.`;
        }
        if (names.indexOf(name) !== index || names.lastIndexOf(name) !== index) {
            return `The tag ${name} is listed more than once.`;
        }
        if (!customTag.value.trim()) return "Enter an SNBT value.";
        try {
            htsw.nbt.parseSnbtText(customTag.value.trim());
            return "";
        } catch (err) {
            return `Invalid SNBT: ${errorMessage(err)}`;
        }
    });
}

function errorMessage(error: unknown): string {
    if (typeof error === "object" && error !== null && "message" in error) {
        return String(error.message);
    }
    return String(error);
}

function bindInputIn(app: HTMLElement, id: string, handler: (value: string) => void): void {
    const input = app.querySelector(`#${id}`) as HTMLInputElement | null;
    input?.addEventListener("input", () => handler(input.value));
}

function bindSelectIn(app: HTMLElement, id: string, handler: (value: string) => void): void {
    const select = app.querySelector(`#${id}`) as HTMLSelectElement | null;
    select?.addEventListener("change", () => handler(select.value));
}

function bindCheckboxIn(app: HTMLElement, id: string, handler: (value: boolean) => void): void {
    const input = app.querySelector(`#${id}`) as HTMLInputElement | null;
    input?.addEventListener("change", () => handler(input.checked));
}

function bindClickIn(app: HTMLElement, id: string, handler: () => void): void {
    app.querySelector(`#${id}`)?.addEventListener("click", handler);
}

function move<T>(values: T[], from: number, to: number): void {
    if (to < 0 || to >= values.length) return;
    const [value] = values.splice(from, 1);
    values.splice(to, 0, value);
}

function option(value: string, label: string, selected: boolean): string {
    return `<option value="${escapeAttr(value)}" ${selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function canSubmit(state: State): boolean {
    return state.entryName.trim().length > 0 &&
        state.importJsonPath.length > 0 &&
        customTagsAreValid(state.customTags);
}

function post(vscode: VsCodeApi, message: ItemEditorToHostMessage): void {
    vscode.postMessage(message);
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.trunc(value)));
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
    return escapeHtml(value).replace(/"/g, "&quot;");
}
