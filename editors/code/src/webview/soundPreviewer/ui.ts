import { AudioEngine } from "./audioEngine";
import { SOUND_CALIBRATION } from "./calibration";
import { scrollPastNumberInputs } from "../numberInputWheel";
import type {
    SoundEntry,
    SoundPreviewFromHostMessage,
    SoundPreviewToHostMessage,
    SoundVersionId,
} from "../protocol";

type VsCodeApi = ReturnType<typeof acquireVsCodeApi>;

type State = {
    sounds: SoundEntry[];
    version: SoundVersionId;
    pitch: number;
    volume: number;
    query: string;
    loadingPath: string | null;
    status: { kind: "idle" | "ok" | "error"; text: string };
};

const DEFAULT_PITCH = 1;
const DEFAULT_VOLUME = 0.7;
const PITCH_MIN = 0;
const PITCH_MAX = 2;
const VOLUME_MIN = 0;
const VOLUME_MAX = 2;
const SLIDER_STEP = 0.05;

export function mountSoundPreviewer(app: HTMLElement, vscode: VsCodeApi): () => void {
    scrollPastNumberInputs();
    const audio = new AudioEngine();
    const state: State = {
        sounds: [],
        version: "1.8.9",
        pitch: DEFAULT_PITCH,
        volume: DEFAULT_VOLUME,
        query: "",
        loadingPath: null,
        status: { kind: "idle", text: "" },
    };

    const onMessage = (event: MessageEvent<SoundPreviewFromHostMessage>) => {
        const message = event.data;
        if (message.type === "init") {
            state.sounds = message.sounds;
            state.version = message.settings.version;
            state.pitch = normalizePitch(message.settings.pitch);
            state.volume = normalizeVolume(message.settings.volume);
            render();
            return;
        }

        if (message.type === "playState") {
            state.loadingPath = null;
            if (!message.ok) {
                state.status = { kind: "error", text: message.error };
                renderStatus();
                renderSoundList({ preserveScroll: true });
                return;
            }
            state.status = { kind: "ok", text: variantText(message.variants.length) };
            renderStatus();
            renderSoundList({ preserveScroll: true });
            void audio.play(
                message.uri,
                SOUND_CALIBRATION.pitchToPlaybackRate(state.pitch),
                SOUND_CALIBRATION.volumeToGain(state.volume),
            ).catch((err) => {
                state.status = {
                    kind: "error",
                    text: err instanceof Error ? err.message : String(err),
                };
                renderStatus();
            });
            return;
        }

        if (message.type === "copyResult") {
            state.status = message.ok
                ? { kind: "ok", text: "Copied sound path." }
                : { kind: "error", text: message.error };
            renderStatus();
        }
    };
    window.addEventListener("message", onMessage);

    render();
    post(vscode, { type: "ready" });
    return () => window.removeEventListener("message", onMessage);

    function render(): void {
        const filtered = filterSounds(state.sounds, state.query);
        app.innerHTML = `
            <div class="app">
                <div class="toolbar">
                    <div class="controls">
                        <div class="segmented" role="group" aria-label="Minecraft version">
                            <button id="version-1-8" type="button" class="${state.version === "1.8.9" ? "active" : ""}">1.8</button>
                            <button id="version-1-21" type="button" class="${state.version === "1.21.1" ? "active" : ""}">1.21</button>
                        </div>
                        <label>
                            <span class="label-text">Search</span>
                            <input id="query" value="${escapeAttr(state.query)}" placeholder="click, wolf, random.orb">
                        </label>
                        <label>
                            <span class="label-text">Pitch <span class="readout">${formatNumber(state.pitch)}</span></span>
                            <div class="range-row">
                                <input id="pitch" type="range" min="${PITCH_MIN}" max="${PITCH_MAX}" step="${SLIDER_STEP}" value="${state.pitch}">
                                <input id="pitchNumber" type="number" min="${PITCH_MIN}" max="${PITCH_MAX}" step="${SLIDER_STEP}" value="${state.pitch}">
                                <button id="resetPitch" class="secondary" type="button">Reset</button>
                            </div>
                        </label>
                        <label>
                            <span class="label-text">Volume <span class="readout">${formatNumber(state.volume)}</span></span>
                            <div class="range-row">
                                <input id="volume" type="range" min="${VOLUME_MIN}" max="${VOLUME_MAX}" step="${SLIDER_STEP}" value="${state.volume}">
                                <input id="volumeNumber" type="number" min="${VOLUME_MIN}" max="${VOLUME_MAX}" step="${SLIDER_STEP}" value="${state.volume}">
                                <button id="resetVolume" class="secondary" type="button">Reset</button>
                            </div>
                        </label>
                    </div>
                    <div id="status" class="status"></div>
                </div>
                <div class="list">
                    ${filtered.length === 0
                        ? `<div class="empty">No matching sounds.</div>`
                        : filtered.map((sound) => soundRow(sound, state)).join("")}
                </div>
            </div>
        `;
        bind(vscode);
        renderStatus();
    }

    function bind(vscode: VsCodeApi): void {
        bindClick("version-1-8", () => {
            state.version = "1.8.9";
            persistSettings(vscode, state);
            render();
        });
        bindClick("version-1-21", () => {
            state.version = "1.21.1";
            persistSettings(vscode, state);
            render();
        });
        bindInput("query", (value) => {
            state.query = value;
            renderSoundList();
        });
        bindInput("pitch", (value) => {
            state.pitch = normalizePitch(Number(value));
            persistSettings(vscode, state);
            updateSoundControls();
        });
        bindInput("pitchNumber", (value) => {
            state.pitch = normalizePitch(Number(value));
            persistSettings(vscode, state);
            updateSoundControls();
        });
        bindInput("volume", (value) => {
            state.volume = normalizeVolume(Number(value));
            persistSettings(vscode, state);
            updateSoundControls();
        });
        bindInput("volumeNumber", (value) => {
            state.volume = normalizeVolume(Number(value));
            persistSettings(vscode, state);
            updateSoundControls();
        });
        bindClick("resetPitch", () => {
            state.pitch = DEFAULT_PITCH;
            persistSettings(vscode, state);
            updateSoundControls();
        });
        bindClick("resetVolume", () => {
            state.volume = DEFAULT_VOLUME;
            persistSettings(vscode, state);
            updateSoundControls();
        });

        bindSoundRows(vscode);
    }

    function renderStatus(): void {
        const status = document.getElementById("status");
        if (!status) return;
        status.className = `status ${state.status.kind === "idle" ? "" : state.status.kind}`;
        status.textContent = state.status.text;
    }

    function renderSoundList(options: { preserveScroll?: boolean } = {}): void {
        const list = document.querySelector<HTMLElement>(".list");
        if (!list) return;
        const scrollTop = options.preserveScroll ? list.scrollTop : 0;
        const scrollLeft = options.preserveScroll ? list.scrollLeft : 0;
        const filtered = filterSounds(state.sounds, state.query);
        list.innerHTML = filtered.length === 0
            ? `<div class="empty">No matching sounds.</div>`
            : filtered.map((sound) => soundRow(sound, state)).join("");
        if (options.preserveScroll) {
            list.scrollTop = scrollTop;
            list.scrollLeft = scrollLeft;
        }
        bindSoundRows(vscode);
    }

    function updateSoundControls(): void {
        const pitch = document.getElementById("pitch") as HTMLInputElement | null;
        const pitchNumber = document.getElementById("pitchNumber") as HTMLInputElement | null;
        const volume = document.getElementById("volume") as HTMLInputElement | null;
        const volumeNumber = document.getElementById("volumeNumber") as HTMLInputElement | null;
        if (pitch) pitch.value = String(state.pitch);
        if (pitchNumber) pitchNumber.value = String(state.pitch);
        if (volume) volume.value = String(state.volume);
        if (volumeNumber) volumeNumber.value = String(state.volume);

        const readouts = document.querySelectorAll<HTMLElement>(".readout");
        if (readouts[0]) readouts[0].textContent = formatNumber(state.pitch);
        if (readouts[1]) readouts[1].textContent = formatNumber(state.volume);
    }

    function bindSoundRows(vscode: VsCodeApi): void {
        for (const button of document.querySelectorAll<HTMLButtonElement>("[data-play-path]")) {
            button.addEventListener("click", () => {
                const sound = state.sounds.find((entry) => entry.path === button.dataset.playPath);
                if (!sound) return;
                if (!canPlay(sound, state.version)) return;
                state.loadingPath = sound.path;
                state.status = { kind: "idle", text: "Loading audio..." };
                renderStatus();
                renderSoundList({ preserveScroll: true });
                post(vscode, {
                    type: "requestPlay",
                    version: state.version,
                    soundPath: sound.path,
                });
            });
        }

        for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy-path]")) {
            button.addEventListener("click", () => {
                const soundPath = button.dataset.copyPath;
                if (!soundPath) return;
                post(vscode, { type: "copyPath", soundPath });
            });
        }
    }
}

function soundRow(sound: SoundEntry, state: State): string {
    const disabled = !canPlay(sound, state.version);
    const loading = state.loadingPath === sound.path;
    return `
        <div class="sound-row">
            <div>
                <div class="sound-name">${escapeHtml(sound.name)}</div>
                <div class="sound-path">${escapeHtml(sound.path)}</div>
                ${disabled ? `<span class="badge">No 1.21 audio</span>` : ""}
            </div>
            <button data-play-path="${escapeAttr(sound.path)}" type="button" ${disabled || loading ? "disabled" : ""}>${loading ? "Loading" : "Play"}</button>
            <button data-copy-path="${escapeAttr(sound.path)}" class="secondary copy" type="button">Copy</button>
        </div>
    `;
}

function canPlay(sound: SoundEntry, version: SoundVersionId): boolean {
    return version === "1.8.9" || sound.mapped1_21 !== null;
}

function filterSounds(sounds: SoundEntry[], query: string): SoundEntry[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return sounds;
    return sounds.filter((sound) =>
        `${sound.name} ${sound.name.split(" ").join("_")} ${sound.path}`.toLowerCase().includes(normalized)
    );
}

function persistSettings(vscode: VsCodeApi, state: State): void {
    post(vscode, {
        type: "saveSettings",
        version: state.version,
        pitch: state.pitch,
        volume: state.volume,
    });
}

function variantText(count: number): string {
    return count <= 1 ? "Playing audio." : `Playing random variant from ${count} options.`;
}

function post(vscode: VsCodeApi, message: SoundPreviewToHostMessage): void {
    vscode.postMessage(message);
}

function bindInput(id: string, handler: (value: string) => void): void {
    const input = document.getElementById(id) as HTMLInputElement | null;
    input?.addEventListener("input", () => handler(input.value));
}

function bindClick(id: string, handler: () => void): void {
    document.getElementById(id)?.addEventListener("click", handler);
}

function normalizePitch(value: number): number {
    return roundToStep(clamp(
        Number.isFinite(value) ? value : DEFAULT_PITCH,
        PITCH_MIN,
        PITCH_MAX,
    ));
}

function normalizeVolume(value: number): number {
    return roundToStep(clamp(
        Number.isFinite(value) ? value : DEFAULT_VOLUME,
        VOLUME_MIN,
        VOLUME_MAX,
    ));
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function roundToStep(value: number): number {
    return Number((Math.round(value / SLIDER_STEP) * SLIDER_STEP).toFixed(2));
}

function formatNumber(value: number): string {
    return Number.isFinite(value) ? value.toFixed(2) : "";
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
