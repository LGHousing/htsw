export function partialEq(src: any, target: any): boolean {
    return Object.keys(target).every((key) => {
        return target[key] === src[key];
    });
}

export function nullableFn<T, R>(
    fn: (value: T) => R
): (value: T | undefined) => R | undefined {
    return (value: T | undefined) => {
        if (!value) return;
        return fn(value);
    };
}