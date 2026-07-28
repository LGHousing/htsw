export class BoundedMap<K, V> {
    protected readonly entries = new Map<K, V>();

    constructor(
        private readonly maxEntries: number,
        private readonly evictionCallback?: (key: K, value: V) => void
    ) {}

    get size(): number {
        return this.entries.size;
    }

    get(key: K): V | undefined {
        return this.entries.get(key);
    }

    has(key: K): boolean {
        return this.entries.has(key);
    }

    set(key: K, value: V): void {
        const existing = this.entries.has(key);
        this.entries.set(key, value);
        if (existing) return;
        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.entries().next();
            if (oldest.done) return;
            const [evictedKey, evictedValue] = oldest.value;
            this.entries.delete(evictedKey);
            this.evictionCallback?.(evictedKey, evictedValue);
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

export class BoundedLruMap<K, V> extends BoundedMap<K, V> {
    override get(key: K): V | undefined {
        if (!this.entries.has(key)) return undefined;
        const value = this.entries.get(key);
        this.entries.delete(key);
        this.entries.set(key, value as V);
        return value;
    }

    peek(key: K): V | undefined {
        return this.entries.get(key);
    }

    override set(key: K, value: V): void {
        this.entries.delete(key);
        super.set(key, value);
    }
}
