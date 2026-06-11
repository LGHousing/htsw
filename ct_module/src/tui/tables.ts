import {
    UIElement,
    UIElementText,
    UIElementVStack,
    UIElementCanvas,
} from "./elements";

export class UIElementTable implements UIElement {
    private columns: string[];
    private rows: UIElement[][] = [];

    constructor(columns: string[]) {
        this.columns = columns;
    }

    addRow(elements: UIElement[]): void {
        this.rows.push(elements);
    }

    getWidth(): number {
        const colStacks = this.buildColumns();
        let w = 0;
        for (let i = 0; i < colStacks.length; i++) w += colStacks[i].getWidth();
        return w + (this.columns.length - 1) * 4; // 1-space gaps between columns
    }

    getHeight(): number {
        return 1 + this.rows.length; // header + data
    }

    render(): string[] {
        const colStacks = this.buildColumns();
        const colWidths: number[] = [];
        for (let i = 0; i < colStacks.length; i++) {
            colWidths.push(colStacks[i].getWidth());
        }

        const canvas = new UIElementCanvas();
        let x = 0;
        for (let i = 0; i < colStacks.length; i++) {
            canvas.addElement(x, 0, colStacks[i]);
            x += colWidths[i] + 4; // 1-space gap
        }

        return canvas.render();
    }

    private buildColumns(): UIElementVStack[] {
        const stacks: UIElementVStack[] = [];
        for (let ci = 0; ci < this.columns.length; ci++) {
            const stack = new UIElementVStack();
            stack.add(new UIElementText(`&7${this.columns[ci]}`));
            stacks.push(stack);
        }

        for (const row of this.rows) {
            for (let ci = 0; ci < this.columns.length; ci++) {
                const cell = ci < row.length ? row[ci] : new UIElementText("");
                stacks[ci].add(cell);
            }
        }

        return stacks;
    }
}
