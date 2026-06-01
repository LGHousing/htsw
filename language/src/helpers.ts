export function partialEq(src: any, target: any): boolean {
    const keys = Object.keys(target);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (target[key] !== src[key]) return false;
    }
    return true;
}

export function nullableFn<T, R>(
    fn: (value: T) => R
): (value: T | undefined) => R | undefined {
    return (value: T | undefined) => {
        if (!value) return;
        return fn(value);
    };
}