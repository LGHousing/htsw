export const SOUND_CALIBRATION = {
    pitchToPlaybackRate(pitch: number): number {
        return clamp(finiteOrDefault(pitch, 1), 0.5, 2);
    },
    volumeToGain(volume: number): number {
        return clamp(finiteOrDefault(volume, 0.7), 0, 1);
    },
};

function finiteOrDefault(value: number, fallback: number): number {
    return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
