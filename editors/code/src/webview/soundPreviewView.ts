import * as vscode from "vscode";
import * as htsw from "htsw";
import { SoundCache } from "../sounds/soundCache";
import { SOUND_NAME_1_8_TO_MODERN, soundEventForMode } from "../sounds/soundMap";
import type {
    SoundEntry,
    SoundPreviewFromHostMessage,
    SoundPreviewToHostMessage,
    SoundMode,
} from "./protocol";

const VERSION_KEY = "htsw.soundPreviewer.version";
const PITCH_KEY = "htsw.soundPreviewer.pitch";
const VOLUME_KEY = "htsw.soundPreviewer.volume";

export class SoundPreviewController {
    private readonly cache: SoundCache;

    public constructor(
        globalStorageUri: vscode.Uri,
        private readonly globalState: vscode.Memento,
    ) {
        this.cache = new SoundCache(vscode.Uri.joinPath(globalStorageUri, "sounds"));
    }

    public cacheRootUri(): vscode.Uri {
        return this.cache.cacheRootUri();
    }

    public async handleMessage(
        webview: vscode.Webview,
        message: SoundPreviewToHostMessage,
    ): Promise<void> {
        switch (message.type) {
            case "ready":
                await this.post(webview, {
                    type: "init",
                    sounds: soundEntries([]),
                    settings: this.readSettings(),
                });
                await this.loadModernSoundCatalog(webview);
                return;
            case "requestPlay":
                await this.play(webview, message.mode, message.soundPath);
                return;
            case "copyPath":
                await this.copyPath(webview, message.soundPath);
                return;
            case "saveSettings":
                await this.saveSettings(message.mode, message.pitch, message.volume);
                return;
        }
    }

    private async play(
        webview: vscode.Webview,
        mode: SoundMode,
        soundPath: string,
    ): Promise<void> {
        const eventName = soundEventForMode(mode, soundPath);
        if (eventName === null) {
            await this.post(webview, {
                type: "playState",
                ok: false,
                mode,
                soundPath,
                error: mode === "modern"
                    ? "No modern audio is mapped for this 1.8 sound."
                    : "No audio is mapped for this sound.",
            });
            return;
        }

        try {
            const cached = await this.cache.ensureSound(mode, eventName);
            await this.post(webview, {
                type: "playState",
                ok: true,
                mode,
                soundPath,
                uri: webview.asWebviewUri(cached.fileUri).toString(),
                variants: cached.variants,
            });
        } catch (err) {
            await this.post(webview, {
                type: "playState",
                ok: false,
                mode,
                soundPath,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    private async copyPath(webview: vscode.Webview, soundPath: string): Promise<void> {
        try {
            await vscode.env.clipboard.writeText(soundPath);
            await this.post(webview, { type: "copyResult", ok: true });
        } catch (err) {
            await this.post(webview, {
                type: "copyResult",
                ok: false,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    private readSettings(): { mode: SoundMode; pitch: number; volume: number } {
        const savedVersion = this.globalState.get<string>(VERSION_KEY, "1.8.9");
        return {
            mode: savedVersion === "modern" || savedVersion === "1.21.1"
                ? "modern"
                : "1.8.9",
            pitch: this.globalState.get<number>(PITCH_KEY, 1),
            volume: this.globalState.get<number>(VOLUME_KEY, 0.7),
        };
    }

    private async saveSettings(
        mode: SoundMode,
        pitch: number,
        volume: number,
    ): Promise<void> {
        await this.globalState.update(VERSION_KEY, mode);
        await this.globalState.update(PITCH_KEY, pitch);
        await this.globalState.update(VOLUME_KEY, volume);
    }

    private async loadModernSoundCatalog(webview: vscode.Webview): Promise<void> {
        try {
            await this.post(webview, {
                type: "soundCatalog",
                sounds: soundEntries(await this.cache.soundEvents("modern")),
            });
        } catch {
            return;
        }
    }

    private async post(
        webview: vscode.Webview,
        message: SoundPreviewFromHostMessage,
    ): Promise<void> {
        await webview.postMessage(message);
    }
}

function soundEntries(modernSoundEvents: readonly string[]): SoundEntry[] {
    const housingSounds = htsw.types.SOUNDS.map((sound) => ({
        name: sound.name,
        path: sound.path,
        mapped1_8: sound.path,
        mappedModern: SOUND_NAME_1_8_TO_MODERN[sound.path] ?? null,
    }));
    const mappedModernEvents = new Set(
        housingSounds
            .map((sound) => sound.mappedModern)
            .filter((sound): sound is string => sound !== null)
    );
    const modernOnlySounds = modernSoundEvents
        .filter((eventName) => !mappedModernEvents.has(eventName))
        .map((eventName) => ({
            name: soundEventDisplayName(eventName),
            path: `minecraft:${eventName}`,
            mapped1_8: null,
            mappedModern: eventName,
        }));

    return [...housingSounds, ...modernOnlySounds];
}

function soundEventDisplayName(eventName: string): string {
    return eventName
        .split(/[./_]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}
