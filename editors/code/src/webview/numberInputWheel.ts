let installed = false;

export function scrollPastNumberInputs(): void {
    if (installed) return;
    installed = true;
    document.addEventListener(
        "wheel",
        (event) => {
            const active = document.activeElement;
            if (
                active instanceof HTMLInputElement &&
                active.type === "number" &&
                event.target === active
            ) {
                active.blur();
            }
        },
        { passive: true },
    );
}
