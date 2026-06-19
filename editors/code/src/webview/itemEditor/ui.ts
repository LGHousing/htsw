import * as htsw from "htsw";
import * as itemIcons from "minecraft-icon-items";
import { buildItemTag } from "htsw-editor-common/item/buildItemNbt";
import { ampToSection } from "htsw-editor-common/text/colorCodes";
import type {
    ImportTarget,
    ItemEditorForm,
    ItemEditorFromHostMessage,
    ItemEditorToHostMessage,
} from "../protocol";

type VsCodeApi = ReturnType<typeof acquireVsCodeApi>;

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

type State = {
    itemSearch: string;
    itemName: string;
    metadata: number | null;
    count: number;
    displayName: string;
    lore: string[];
    enchants: { name: string; level: number }[];
    entryName: string;
    importJsonPath: string;
    targets: ImportTarget[];
    createLeftClickActions: boolean;
    createRightClickActions: boolean;
    status: { kind: "idle" | "ok" | "error"; text: string };
};

const ITEMS = htsw.types.MINECRAFT_ITEMS as readonly MinecraftItem[];
const ENCHANTMENTS = htsw.types.ENCHANTMENTS;
const FORMAT_COLORS: Record<string, string> = {
    "0": "#000000",
    "1": "#0000AA",
    "2": "#00AA00",
    "3": "#00AAAA",
    "4": "#AA0000",
    "5": "#AA00AA",
    "6": "#FFAA00",
    "7": "#AAAAAA",
    "8": "#555555",
    "9": "#5555FF",
    a: "#55FF55",
    b: "#55FFFF",
    c: "#FF5555",
    d: "#FF55FF",
    e: "#FFFF55",
    f: "#FFFFFF",
};

export function mountItemEditor(app: HTMLElement, vscode: VsCodeApi): () => void {
    const firstItem = ITEMS[0];
    const state: State = {
        itemSearch: "",
        itemName: firstItem?.name ?? "stone",
        metadata: firstMetadata(firstItem),
        count: 1,
        displayName: "",
        lore: [""],
        enchants: [],
        entryName: firstItem?.displayName ?? "Stone",
        importJsonPath: "",
        targets: [],
        createLeftClickActions: false,
        createRightClickActions: false,
        status: { kind: "idle", text: "" },
    };

    const onMessage = (event: MessageEvent<ItemEditorFromHostMessage>) => {
        const message = event.data;
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
                ? { kind: "ok", text: "Generated item files." }
                : { kind: "error", text: message.error };
            renderStatus();
        }
    };
    window.addEventListener("message", onMessage);

    render();
    post(vscode, { type: "requestImportTargets" });
    return () => window.removeEventListener("message", onMessage);

    function render(): void {
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
                        <h2>Project</h2>
                        <label>
                            <span class="label-text">Entry name</span>
                            <input id="entryName" value="${escapeAttr(state.entryName)}" placeholder="Launcher">
                        </label>
                        <label>
                            <span class="label-text">Target import.json</span>
                            <select id="importJsonPath">
                                ${state.targets.map((target) => option(target.fsPath, target.label, target.fsPath === state.importJsonPath)).join("")}
                            </select>
                        </label>
                        <div class="checks">
                            <label class="check">
                                <input id="createLeftClickActions" type="checkbox" ${state.createLeftClickActions ? "checked" : ""}>
                                <span>Scaffold empty left-click actions .htsl</span>
                            </label>
                            <label class="check">
                                <input id="createRightClickActions" type="checkbox" ${state.createRightClickActions ? "checked" : ""}>
                                <span>Scaffold empty right-click actions .htsl</span>
                            </label>
                        </div>
                        <button id="generate" type="button" ${canSubmit(state) ? "" : "disabled"}>Generate</button>
                        <div id="status" class="status"></div>
                    </div>
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
        updateFormattedPreviews();
        updateSnbtPreview();
        renderStatus();
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
            updateGenerateState();
        });
        bindSelect("importJsonPath", (value) => {
            state.importJsonPath = value;
            updateGenerateState();
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
                state.enchants[i].level = clamp(Number(value), 1, 32767);
                updateFormattedPreviews();
                updateSnbtPreview();
            });
            bindClick(`enchant-remove-${i}`, () => {
                state.enchants.splice(i, 1);
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
        bindClick("generate", () => {
            if (!canSubmit(state)) return;
            state.status = { kind: "idle", text: "Generating..." };
            renderStatus();
            post(vscode, { type: "submitItem", form: toForm(state) });
        });
    }

    function updateSnbtPreview(): void {
        const preview = document.getElementById("snbtPreview");
        if (!preview) return;
        try {
            preview.textContent = htsw.nbt.printSnbt(buildItemTag(toForm(state)), {
                pretty: true,
                indent: "    ",
            });
        } catch (err) {
            preview.textContent = err instanceof Error ? err.message : String(err);
        }
    }

    function updateFormattedPreviews(): void {
        renderItemPreview(state);
        startMagicTicker();
    }

    function updateItemSelectOptions(): void {
        const select = document.getElementById("itemName") as HTMLSelectElement | null;
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

    function updateGenerateState(): void {
        const generate = document.getElementById("generate") as HTMLButtonElement | null;
        if (generate) generate.disabled = !canSubmit(state);
    }

    function renderStatus(): void {
        const status = document.getElementById("status");
        if (!status) return;
        status.className = `status ${state.status.kind === "idle" ? "" : state.status.kind}`;
        status.textContent = state.status.text;
    }
}

function toForm(state: State): ItemEditorForm {
    return {
        itemName: state.itemName,
        count: state.count,
        metadata: state.metadata,
        displayName: state.displayName,
        lore: trimTrailingEmptyLines(state.lore),
        enchants: state.enchants,
        entryName: state.entryName,
        importJsonPath: state.importJsonPath,
        createLeftClickActions: state.createLeftClickActions,
        createRightClickActions: state.createRightClickActions,
    };
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

function renderItemPreview(state: State): void {
    const host = document.getElementById("itemPreview");
    if (!host) return;

    const item = currentItem(state);
    const displayName = state.displayName.trim() || (
        (item ? variantDisplayName(item, state.metadata) : undefined) ??
        item?.displayName ??
        state.itemName
    );
    const lore = trimTrailingEmptyLines(state.lore);
    const tagCount = 1 +
        (state.displayName.trim() || lore.length > 0 ? 1 : 0) +
        (state.enchants.length > 0 ? 1 : 0);

    const stack = itemStackPreview(state, displayName);
    if (state.count > 1) {
        const count = document.createElement("span");
        count.className = "item-stack-count";
        count.textContent = String(state.count);
        stack.appendChild(count);
    }

    const tooltip = document.createElement("div");
    tooltip.className = "mc-tooltip";
    tooltip.appendChild(mcLine(displayName, state.displayName.trim() ? "" : "&f"));
    for (const enchant of state.enchants) {
        tooltip.appendChild(mcLine(enchantmentTooltipLine(enchant), "&7"));
    }
    for (const line of lore) {
        tooltip.appendChild(mcLine(line, ""));
    }
    tooltip.appendChild(mcLine(`minecraft:${state.itemName}`, "&8"));
    tooltip.appendChild(mcLine(`NBT: ${tagCount} tag(s)`, "&8"));

    host.replaceChildren(stack, document.createElement("br"), tooltip);
}

function itemStackPreview(state: State, displayName: string): HTMLElement {
    const stack = document.createElement("div");
    stack.className = "item-stack";

    const item = currentItem(state);
    const icon = item ? itemIcons.get(`${item.id}:${state.metadata ?? 0}`) : null;
    if (icon?.icon) {
        const img = document.createElement("img");
        img.alt = displayName.replace(/[&§][0-9a-fk-or]/gi, "");
        img.src = `data:image/png;base64,${icon.icon}`;
        stack.appendChild(img);
    } else {
        stack.textContent = itemInitials(displayName);
    }
    return stack;
}

function enchantmentTooltipLine(enchant: { name: string; level: number }): string {
    return `${enchant.name} ${romanNumeral(enchant.level)}`;
}

function romanNumeral(value: number): string {
    const rounded = Math.max(1, Math.min(3999, Math.trunc(value)));
    const parts: [number, string][] = [
        [1000, "M"],
        [900, "CM"],
        [500, "D"],
        [400, "CD"],
        [100, "C"],
        [90, "XC"],
        [50, "L"],
        [40, "XL"],
        [10, "X"],
        [9, "IX"],
        [5, "V"],
        [4, "IV"],
        [1, "I"],
    ];
    let remaining = rounded;
    let out = "";
    for (const [amount, numeral] of parts) {
        while (remaining >= amount) {
            out += numeral;
            remaining -= amount;
        }
    }
    return out;
}

function mcLine(text: string, prefix: string): HTMLElement {
    const line = document.createElement("div");
    line.className = "mc-line";
    line.replaceChildren(...formatMinecraftText(`${prefix}${text}`));
    return line;
}

function itemInitials(displayName: string): string {
    const plain = displayName.replace(/[&§][0-9a-fk-or]/gi, "").trim();
    const words = plain.split(/\s+/).filter(Boolean);
    if (words.length === 0) return "?";
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    return words.slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join("");
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
            <input id="enchant-level-${index}" type="number" min="1" max="32767" value="${enchant.level}">
            <button id="enchant-remove-${index}" class="secondary icon" type="button" title="Remove">×</button>
        </div>
    `;
}

const MAGIC_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?#@$%&";
let magicTickerStarted = false;

function formatMinecraftText(value: string): Node[] {
    const nodes: Node[] = [];
    let color = "";
    let bold = false;
    let italic = false;
    let underline = false;
    let strike = false;
    let magic = false;
    let current = "";
    const sectioned = ampToSection(value);

    function flush(): void {
        if (!current) return;
        const span = document.createElement("span");
        if (magic) {
            span.className = "mc-magic";
            for (const ch of current) {
                span.appendChild(magicCharNode(ch));
            }
        } else {
            span.textContent = current;
        }
        if (color) span.style.color = color;
        if (bold) span.style.fontWeight = "700";
        if (italic) span.style.fontStyle = "italic";
        const decorations = [underline ? "underline" : "", strike ? "line-through" : ""]
            .filter(Boolean)
            .join(" ");
        if (decorations) span.style.textDecoration = decorations;
        nodes.push(span);
        current = "";
    }

    for (let i = 0; i < sectioned.length; i++) {
        const ch = sectioned[i];
        if (ch !== "§" || i + 1 >= sectioned.length) {
            current += ch;
            continue;
        }
        const code = sectioned[++i].toLowerCase();
        flush();
        if (FORMAT_COLORS[code]) {
            color = FORMAT_COLORS[code];
            bold = false;
            italic = false;
            underline = false;
            strike = false;
            magic = false;
        } else if (code === "k") {
            magic = true;
        } else if (code === "l") {
            bold = true;
        } else if (code === "o") {
            italic = true;
        } else if (code === "n") {
            underline = true;
        } else if (code === "m") {
            strike = true;
        } else if (code === "r") {
            color = "";
            bold = false;
            italic = false;
            underline = false;
            strike = false;
            magic = false;
        }
    }
    flush();
    return nodes;
}

function startMagicTicker(): void {
    if (magicTickerStarted) return;
    magicTickerStarted = true;
    window.setInterval(() => {
        for (const node of document.querySelectorAll<HTMLElement>(".mc-magic-char")) {
            const width = Number(node.dataset.mcWidth ?? 6);
            node.textContent = randomMagicChar(width);
        }
    }, 90);
}

function magicCharNode(original: string): HTMLElement {
    const width = minecraftCharWidth(original);
    const span = document.createElement("span");
    span.className = "mc-magic-char";
    span.dataset.mcWidth = String(width);
    span.style.width = `${Math.max(1, width) * 2}px`;
    span.textContent = randomMagicChar(width);
    return span;
}

function randomMagicChar(width: number): string {
    const candidates = MAGIC_CHARS
        .split("")
        .filter((ch) => minecraftCharWidth(ch) === width);
    const pool = candidates.length > 0 ? candidates : MAGIC_CHARS.split("");
    return pool[Math.floor(Math.random() * pool.length)];
}

function minecraftCharWidth(ch: string): number {
    if (ch === " ") return 4;
    if ("!.,:;i|'".includes(ch)) return 2;
    if ("l`".includes(ch)) return 3;
    if ("I[]t".includes(ch)) return 4;
    if ("fk{}<>\"*()".includes(ch)) return 5;
    if (ch.charCodeAt(0) > 127) return 7;
    return 6;
}

function bindInput(id: string, handler: (value: string) => void): void {
    const input = document.getElementById(id) as HTMLInputElement | null;
    input?.addEventListener("input", () => handler(input.value));
}

function bindSelect(id: string, handler: (value: string) => void): void {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    select?.addEventListener("change", () => handler(select.value));
}

function bindCheckbox(id: string, handler: (value: boolean) => void): void {
    const input = document.getElementById(id) as HTMLInputElement | null;
    input?.addEventListener("change", () => handler(input.checked));
}

function bindClick(id: string, handler: () => void): void {
    document.getElementById(id)?.addEventListener("click", handler);
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
    return state.entryName.trim().length > 0 && state.importJsonPath.length > 0;
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
