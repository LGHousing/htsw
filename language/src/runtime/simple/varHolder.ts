import { VarString, type Var } from "../vars";

export class VarHolder<T> {
    private vars: Map<string, { raw: T; value: Var<any> }>;

    constructor() {
        this.vars = new Map();
    }

    has(key: T): boolean {
        return this.vars.has(this.keyFor(key));
    }

    get(key: T, fallback: Var<any> = new VarString("")): Var<any> {
        return this.vars.get(this.keyFor(key))?.value ?? fallback;
    }

    set(key: T, value: Var<any>): void {
        this.vars.set(this.keyFor(key), { raw: key, value });
    }

    unset(key: T): void {
        this.vars.delete(this.keyFor(key));
    }

    keys(): Set<T> {
        const set = new Set<T>();
        for (const entry of this.vars.values()) {
            set.add(entry.raw);
        }
        return set;
    }

    private keyFor(key: T): string {
        if (typeof key === "object" && key !== null) {
            return JSON.stringify(key);
        }
        return String(key);
    }
}
