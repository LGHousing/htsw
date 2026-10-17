import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { FALLBACK_SOUND_VERSIONS } from "./soundMap";
import type { SoundMode } from "../webview/protocol";
import { download, fetchText } from "../http";

const MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const MANIFEST_FALLBACK_URL = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
const OBJECT_BASE_URL = "https://resources.download.minecraft.net";

type VersionManifest = {
    latest: { release: string };
    versions: { id: string; url: string }[];
};

export type VersionJson = {
    assetIndex: { url: string };
};

type AssetIndex = {
    objects: Record<string, { hash: string; size: number }>;
};

type SoundsJson = Record<string, { sounds?: SoundVariant[] }>;

type SoundVariant = string | { name?: string; type?: string };

export type ResolvedSoundObject = {
    hash: string;
    variants: string[];
    objectKey: string;
};

type SoundResolution = {
    variants: string[];
    available: Array<Omit<ResolvedSoundObject, "variants">>;
};

export type ResolvedSoundVersion = {
    id: string;
    versionJson: VersionJson;
};

export async function resolveSoundVersion(
    mode: SoundMode
): Promise<ResolvedSoundVersion> {
    const fallback = FALLBACK_SOUND_VERSIONS[mode];
    if (mode === "1.8.9") {
        return {
            id: fallback.id,
            versionJson: await fetchJson(fallback.versionJsonUrl),
        };
    }

    for (const url of [MANIFEST_URL, MANIFEST_FALLBACK_URL]) {
        try {
            const manifest = await fetchJson<VersionManifest>(url);
            const match = manifest.versions.find(
                (entry) => entry.id === manifest.latest.release
            );
            if (match) {
                return {
                    id: match.id,
                    versionJson: await fetchJson(match.url),
                };
            }
        } catch {
            continue;
        }
    }
    return {
        id: fallback.id,
        versionJson: await fetchJson(fallback.versionJsonUrl),
    };
}

export async function fetchAssetIndex(versionJson: VersionJson): Promise<AssetIndex> {
    return fetchJson(versionJson.assetIndex.url);
}

export async function fetchSoundsJson(index: AssetIndex): Promise<SoundsJson> {
    const object = index.objects["minecraft/sounds.json"];
    if (!object) throw new Error("Asset index has no minecraft/sounds.json entry.");
    return fetchJson(objectUrl(object.hash));
}

export function resolveSoundObject(
    index: AssetIndex,
    sounds: SoundsJson,
    eventName: string,
): ResolvedSoundObject {
    const resolved = resolveSoundObjects(index, sounds, eventName);
    if (resolved.variants.length === 0) {
        throw new Error(`No audio variants for sound event "${eventName}".`);
    }
    if (resolved.available.length > 0) {
        return {
            ...resolved.available[Math.floor(Math.random() * resolved.available.length)],
            variants: resolved.variants,
        };
    }
    throw new Error(`No cached object entry for sound event "${eventName}".`);
}

export function soundEventsWithAudio(index: AssetIndex, sounds: SoundsJson): string[] {
    return Object.keys(sounds)
        .filter((eventName) => resolveSoundObjects(index, sounds, eventName).available.length > 0)
        .sort();
}

function resolveSoundObjects(
    index: AssetIndex,
    sounds: SoundsJson,
    eventName: string,
    ancestors = new Set<string>(),
): SoundResolution {
    if (ancestors.has(eventName)) return { variants: [], available: [] };

    const event = sounds[eventName];
    const variants: string[] = [];
    const available: SoundResolution["available"] = [];
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(eventName);

    for (const variant of event?.sounds ?? []) {
        const name = soundVariantName(variant);
        if (name === null) continue;
        if (typeof variant !== "string" && variant.type === "event") {
            const nested = resolveSoundObjects(index, sounds, name, nextAncestors);
            variants.push(...nested.variants);
            available.push(...nested.available);
            continue;
        }

        variants.push(name);
        const objectKey = `minecraft/sounds/${name}.ogg`;
        const object = index.objects[objectKey];
        if (!object) continue;
        available.push({ hash: object.hash, objectKey });
    }

    return { variants: [...new Set(variants)], available };
}

export async function downloadObject(hash: string, destPath: string): Promise<void> {
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    const tempPath = `${destPath}.${Date.now()}.tmp`;
    try {
        const actual = await download(objectUrl(hash), tempPath, "sha1");
        if (actual.toLowerCase() !== hash.toLowerCase()) {
            throw new Error("downloaded object hash mismatch");
        }
        await fs.rename(tempPath, destPath);
    } finally {
        await fs.rm(tempPath, { force: true });
    }
}

export async function verifySha1(filePath: string, expected: string): Promise<boolean> {
    try {
        const data = await fs.readFile(filePath);
        return createHash("sha1").update(data).digest("hex").toLowerCase() === expected.toLowerCase();
    } catch {
        return false;
    }
}

function soundVariantName(variant: SoundVariant): string | null {
    const raw = typeof variant === "string" ? variant : variant.name;
    if (!raw) return null;
    return raw.replace(/^minecraft:/, "");
}

function objectUrl(hash: string): string {
    return `${OBJECT_BASE_URL}/${hash.slice(0, 2)}/${hash}`;
}

function fetchJson<T>(url: string): Promise<T> {
    return fetchText(url).then((text) => JSON.parse(text) as T);
}

