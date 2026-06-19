export class AudioEngine {
    private context: AudioContext | null = null;
    private readonly buffers = new Map<string, AudioBuffer>();

    public async play(uri: string, playbackRate: number, gainValue: number): Promise<void> {
        try {
            const context = this.audioContext();
            if (context.state === "suspended") await context.resume();
            const buffer = await this.bufferFor(uri, context);
            const source = context.createBufferSource();
            const gain = context.createGain();
            source.buffer = buffer;
            source.playbackRate.value = playbackRate;
            gain.gain.value = gainValue;
            source.connect(gain);
            gain.connect(context.destination);
            source.start();
        } catch {
            await playWithAudioElement(uri, playbackRate, gainValue);
        }
    }

    private audioContext(): AudioContext {
        if (this.context) return this.context;
        this.context = new AudioContext();
        return this.context;
    }

    private async bufferFor(uri: string, context: AudioContext): Promise<AudioBuffer> {
        const cached = this.buffers.get(uri);
        if (cached) return cached;

        const response = await fetch(uri);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        const buffer = await context.decodeAudioData(data.slice(0));
        this.buffers.set(uri, buffer);
        return buffer;
    }
}

function playWithAudioElement(uri: string, playbackRate: number, volume: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const audio = new Audio(uri);
        audio.playbackRate = playbackRate;
        audio.volume = volume;
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("Audio playback failed."));
        void audio.play().then(() => resolve(), reject);
    });
}
