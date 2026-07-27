export class BoundedLruMap<K, V> {
    private readonly entries = new Map<K, V>();

    constructor(
        private readonly maxEntries: number,
        private readonly onEvict?: (key: K, value: V) => void
    ) {}

    get size(): number {
        return this.entries.size;
    }

    get(key: K): V | undefined {
        const value = this.entries.get(key);
        if (value === undefined) return undefined;
        this.entries.delete(key);
        this.entries.set(key, value);
        return value;
    }

    has(key: K): boolean {
        return this.entries.has(key);
    }

    set(key: K, value: V): void {
        this.entries.delete(key);
        this.entries.set(key, value);
        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next();
            if (oldest.done) return;
            const evicted = this.entries.get(oldest.value);
            this.entries.delete(oldest.value);
            if (evicted !== undefined) this.onEvict?.(oldest.value, evicted);
        }
    }

    delete(key: K): boolean {
        return this.entries.delete(key);
    }

    clear(): void {
        this.entries.clear();
    }

    values(): IterableIterator<V> {
        return this.entries.values();
    }

    deleteWhere(predicate: (key: K, value: V) => boolean): number {
        let deleted = 0;
        for (const [key, value] of this.entries) {
            if (!predicate(key, value)) continue;
            this.entries.delete(key);
            deleted++;
        }
        return deleted;
    }
}
