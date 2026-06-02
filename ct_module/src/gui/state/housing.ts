let housingUuid: string | null = null;

export function getHousingUuid(): string | null {
    return housingUuid;
}
export function setHousingUuid(uuid: string | null): void {
    housingUuid = uuid;
}
