export function lineAmountCents(quantity: string, unitCost: string): bigint | null;
export function purchaseAmountCents(lines: { quantity: string; unitCost: string }[]): bigint | null;
