export class Observers<T> {
    private readonly listeners: Array<(event: T) => void> = [];

    observe(listener: (event: T) => void): () => void {
        this.listeners.push(listener);
        return () => {
            const index = this.listeners.indexOf(listener);
            if (index >= 0) this.listeners.splice(index, 1);
        };
    }

    emit(event: T): void {
        for (let i = 0; i < this.listeners.length; i++) this.listeners[i](event);
    }
}
