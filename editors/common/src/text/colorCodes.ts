const FORMAT_CODE_RE = /[&§][0-9a-fk-or]/gi;

export function ampToSection(value: string): string {
    return value.replace(/&([0-9a-fk-or])/gi, "§$1");
}

export function sectionToAmp(value: string): string {
    return value.replace(/§([0-9a-fk-or])/gi, "&$1");
}

export function stripFormatting(value: string): string {
    return value.replace(FORMAT_CODE_RE, "");
}
