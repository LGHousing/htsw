import * as htsw from "htsw";
import * as itemIcons from "minecraft-icon-items";
import minecraftFontDataUri from "@south-paw/typeface-minecraft/files/minecraft.woff2?inline";
import { ampToSection } from "htsw-editor-common/text/colorCodes";

type ItemViewEnchant = { name: string; level: number };

/** Everything the Minecraft item preview needs, independent of where it came
 * from (the Item Editor form or a parsed `.snbt`). Display/lore keep their raw
 * `&`/`§` codes; the renderer normalizes them. */
export type ItemView = {
    /** Bare item name (no `minecraft:`) — drives the sprite, rarity, and id line. */
    itemName: string;
    metadata: number;
    count: number;
    /** Custom display name, or "" to fall back to the vanilla item name. */
    displayName: string;
    lore: string[];
    enchants: ItemViewEnchant[];
};

type MinecraftItem = {
    id: number;
    displayName: string;
    name: string;
    variations?: readonly { metadata: number; displayName: string }[];
};

const ITEMS = htsw.types.MINECRAFT_ITEMS as readonly MinecraftItem[];
const ITEM_BY_NAME = new Map<string, MinecraftItem>();
for (const item of ITEMS) ITEM_BY_NAME.set(item.name, item);

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

function numericItemId(name: string): number | undefined {
    return ITEM_BY_NAME.get(bareItemName(name))?.id;
}

/** A `data:image/png` for the item's inventory sprite, or null when the item id
 * is unknown (callers fall back to a glyph). */
export function itemSpriteDataUri(itemName: string, metadata: number): string | null {
    const id = numericItemId(itemName);
    if (id === undefined) return null;
    const png = itemIcons.get(`${id}:${metadata}`)?.icon ?? itemIcons.get(`${id}:0`)?.icon;
    return png ? `data:image/png;base64,${png}` : null;
}

/** Render the stack sprite + tooltip into `host`, matching the in-game hover. */
export function renderItemPreviewInto(host: HTMLElement, view: ItemView): void {
    ensureMinecraftFont();
    ensureItemStyles();
    host.replaceChildren(renderItemStack(view), document.createElement("br"), renderItemTooltip(view));
    startMagicTicker();
}

function renderItemStack(view: ItemView): HTMLElement {
    ensureItemStyles();
    const stack = document.createElement("div");
    stack.className = "item-stack";

    const displayName = resolveDisplayName(view);
    const dataUri = itemSpriteDataUri(view.itemName, view.metadata);
    if (dataUri) {
        const img = document.createElement("img");
        img.alt = stripCodes(displayName);
        img.src = dataUri;
        stack.appendChild(img);
    } else {
        stack.textContent = itemInitials(displayName);
    }

    if (view.count > 1) {
        const count = document.createElement("span");
        count.className = "item-stack-count";
        count.textContent = String(view.count);
        stack.appendChild(count);
    }
    return stack;
}

function renderItemTooltip(view: ItemView): HTMLElement {
    ensureMinecraftFont();
    ensureItemStyles();
    const displayName = resolveDisplayName(view);
    const lore = trimTrailingEmptyLines(view.lore);
    const hasCustomName = view.displayName.trim().length > 0;
    const tagCount = 1 +
        (hasCustomName || lore.length > 0 ? 1 : 0) +
        (view.enchants.length > 0 ? 1 : 0);

    const namePrefix = nameRarityColor(view) + (hasCustomName ? "&o" : "");

    const tooltip = document.createElement("div");
    tooltip.className = "mc-tooltip";
    tooltip.appendChild(mcLine(displayName, namePrefix));
    for (const enchant of view.enchants) {
        tooltip.appendChild(mcLine(enchantmentTooltipLine(enchant), "&7"));
    }
    for (const line of lore) {
        tooltip.appendChild(mcLine(line, "&7"));
    }
    tooltip.appendChild(mcLine(`minecraft:${bareItemName(view.itemName)}`, "&8"));
    tooltip.appendChild(mcLine(`NBT: ${tagCount} tag(s)`, "&8"));
    return tooltip;
}

function resolveDisplayName(view: ItemView): string {
    const custom = view.displayName.trim();
    if (custom) return custom;
    const item = ITEM_BY_NAME.get(bareItemName(view.itemName));
    return variantDisplayName(item, view.metadata) ?? item?.displayName ?? view.itemName;
}

function variantDisplayName(item: MinecraftItem | undefined, metadata: number): string | undefined {
    return item?.variations?.find((variant) => variant.metadata === metadata)?.displayName;
}

function nameRarityColor(view: ItemView): string {
    const name = bareItemName(view.itemName);
    if (name === "golden_apple") return view.metadata === 0 ? "&b" : "&d";
    if (name.startsWith("record_")) return "&b";
    if (name === "enchanted_book" && view.enchants.length > 0) return "&e";
    return view.enchants.length > 0 ? "&b" : "&f";
}

function enchantmentTooltipLine(enchant: ItemViewEnchant): string {
    return `${enchant.name} ${romanNumeral(enchant.level)}`;
}

function romanNumeral(value: number): string {
    const rounded = Math.max(1, Math.min(3999, Math.trunc(value)));
    const parts: [number, string][] = [
        [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
        [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
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
    const plain = stripCodes(displayName).trim();
    const words = plain.split(/\s+/).filter(Boolean);
    if (words.length === 0) return "?";
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    return words.slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join("");
}

function bareItemName(name: string): string {
    return name.replace(/^minecraft:/, "").toLowerCase();
}

function stripCodes(value: string): string {
    return value.replace(/[&§][0-9a-fk-or]/gi, "");
}

function trimTrailingEmptyLines(lines: readonly string[]): string[] {
    const out = [...lines];
    while (out.length > 0 && out[out.length - 1] === "") out.pop();
    return out;
}

function shadowColorFor(hexColor: string): string {
    const rgb = parseInt(hexColor.slice(1), 16);
    const quartered = (rgb >> 2) & 0x3f3f3f;
    return `#${quartered.toString(16).padStart(6, "0")}`;
}

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
            for (const ch of current) span.appendChild(magicCharNode(ch));
        } else {
            span.textContent = current;
        }
        if (color) {
            span.style.color = color;
            span.style.textShadow = `2px 2px ${shadowColorFor(color)}`;
        }
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
            bold = italic = underline = strike = magic = false;
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
            bold = italic = underline = strike = magic = false;
        }
    }
    flush();
    return nodes;
}

const MAGIC_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?#@$%&";
let magicTickerStarted = false;

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
    const candidates = MAGIC_CHARS.split("").filter((ch) => minecraftCharWidth(ch) === width);
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

const FONT_STYLE_ID = "minecraft-font-face";

export function ensureMinecraftFont(): void {
    if (document.getElementById(FONT_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = FONT_STYLE_ID;
    style.textContent = `@font-face {
        font-family: "Minecraft";
        src: url(${minecraftFontDataUri}) format("woff2");
    }`;
    document.head.appendChild(style);
}

const ITEM_STYLE_ID = "mc-item-styles";

/** Injects the sprite + tooltip CSS once, so any webview (Item Editor tab or
 * project tree hover) renders the preview without shipping the rules twice. */
function ensureItemStyles(): void {
    if (document.getElementById(ITEM_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = ITEM_STYLE_ID;
    style.textContent = `
        .item-stack {
            display: inline-grid;
            place-items: center;
            position: relative;
            width: 52px;
            height: 52px;
            margin-bottom: 12px;
            color: #fff;
            background: #1f1f24;
            border: 2px solid #6f6f78;
            box-shadow: inset 0 0 0 2px #111116;
            font-family: var(--vscode-editor-font-family), monospace;
            font-size: 10px;
            text-align: center;
            overflow: hidden;
        }
        .item-stack img {
            width: 32px;
            height: 32px;
            image-rendering: pixelated;
        }
        .item-stack-count {
            position: absolute;
            right: 3px;
            bottom: 1px;
            color: #fff;
            font-family: "Minecraft", var(--vscode-editor-font-family), monospace;
            font-size: 16px;
            text-shadow: 2px 2px #3f3f3f;
        }
        .mc-tooltip {
            position: relative;
            display: inline-block;
            max-width: min(560px, 100%);
            padding: 8px 10px;
            color: #aaa;
            background: rgba(16, 0, 16, 0.94);
            font-family: "Minecraft", var(--vscode-editor-font-family), monospace;
            font-size: 16px;
            line-height: 20px;
            image-rendering: pixelated;
            -webkit-font-smoothing: none;
            font-smooth: never;
        }
        .mc-tooltip::before {
            content: "";
            position: absolute;
            inset: 2px;
            border: 2px solid transparent;
            background: linear-gradient(rgba(80, 0, 255, 0.31), rgba(40, 0, 127, 0.31)) border-box;
            -webkit-mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor;
            mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0);
            mask-composite: exclude;
            pointer-events: none;
        }
        .mc-line {
            min-height: 20px;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            text-shadow: 2px 2px #2a2a2a;
        }
        .mc-line:first-child {
            margin-bottom: 4px;
        }
        .mc-muted {
            color: #555;
        }
        .mc-magic-char {
            display: inline-block;
            overflow: hidden;
            text-align: center;
            vertical-align: baseline;
        }
    `;
    document.head.appendChild(style);
}
