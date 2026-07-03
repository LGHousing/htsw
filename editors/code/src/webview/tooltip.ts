// Native title tooltips don't render inside VS Code's webview iframe, so this
// replaces them: it lifts `title` attributes into `data-tip` on hover and shows
// a floating tooltip element instead. Markup keeps using plain `title="…"`.

const SHOW_DELAY_MS = 480;
const VIEWPORT_PADDING = 4;

export function installTooltips(): void {
    const tip = document.createElement("div");
    tip.className = "webview-tooltip";
    document.body.appendChild(tip);

    const style = document.createElement("style");
    style.textContent = `
        .webview-tooltip {
            position: fixed;
            display: none;
            box-sizing: border-box;
            max-width: min(320px, calc(100vw - ${VIEWPORT_PADDING * 2}px));
            padding: 3px 7px;
            border: 1px solid var(--vscode-editorHoverWidget-border, #454545);
            border-radius: 3px;
            background: var(--vscode-editorHoverWidget-background, #252526);
            color: var(--vscode-editorHoverWidget-foreground, #cccccc);
            font-size: 12px;
            line-height: 1.4;
            white-space: pre-line;
            overflow-wrap: anywhere;
            pointer-events: none;
            z-index: 1000;
        }
    `;
    document.head.appendChild(style);

    let target: Element | null = null;
    let showTimer: ReturnType<typeof setTimeout> | undefined;

    const hide = () => {
        clearTimeout(showTimer);
        target = null;
        tip.style.display = "none";
    };

    const show = () => {
        const text = target?.getAttribute("data-tip");
        if (!target?.isConnected || !text) return;
        tip.textContent = text;
        tip.style.display = "block";
        tip.style.left = "0px";
        tip.style.top = "0px";
        tip.style.width = "";
        tip.style.maxWidth = "";
        const anchor = target.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
        const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
        const availableWidth = Math.max(1, viewportWidth - VIEWPORT_PADDING * 2);
        tip.style.maxWidth = `${availableWidth}px`;
        if (tip.scrollWidth > availableWidth) {
            tip.style.width = `${availableWidth}px`;
        }
        const size = tip.getBoundingClientRect();
        const maxLeft = Math.max(VIEWPORT_PADDING, viewportWidth - size.width - VIEWPORT_PADDING);
        const left = Math.min(Math.max(anchor.left, VIEWPORT_PADDING), maxLeft);
        const below = anchor.bottom + 6;
        const top = below + size.height > viewportHeight - VIEWPORT_PADDING
            ? anchor.top - size.height - 6
            : below;
        tip.style.left = `${left}px`;
        tip.style.top = `${Math.max(VIEWPORT_PADDING, top)}px`;
    };

    document.addEventListener("mouseover", (event) => {
        const next = (event.target as Element | null)?.closest?.("[title], [data-tip]") ?? null;
        if (next === target) return;

        const title = next?.getAttribute("title");
        if (next && title) {
            next.setAttribute("data-tip", title);
            next.removeAttribute("title");
        }

        hide();
        if (!next?.getAttribute("data-tip")) return;
        target = next;
        showTimer = setTimeout(show, SHOW_DELAY_MS);
    });

    document.addEventListener("mouseout", (event) => {
        if (!target) return;
        const to = event.relatedTarget as Element | null;
        if (!to || !target.contains(to)) hide();
    });

    document.addEventListener("mousedown", hide, true);
    document.addEventListener("wheel", hide, { capture: true, passive: true });
}
