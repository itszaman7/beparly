export type CheckoutPayload = {
  mode: 'quick' | 'manual'; price_tier: 'retail' | 'wholesale'; location_id: number;
  income_category_id?: number; customer_id?: string; paid: string; due_date?: string;
  account_id?: string; discount: string; discount_type: 'amount' | 'percent';
  delivery_fee?: string; billing_address?: Record<string, string>;
  delivery_address?: string; source?: string; notes?: string; invoice_date?: string;
  lines: { product_id: string; quantity: string; variant_id?: string; unit_id?: string }[];
};

export type CheckoutState = 'prepared' | 'sending' | 'awaiting_confirmation' | 'confirmed' | 'rejected' | 'needs_review';
export type CheckoutCommand = {
  id: string; businessId: number; userId: number; payload: CheckoutPayload;
  fingerprint: string; createdAt: string; state: CheckoutState;
  saleId: string | null; lastError: string | null; attempts: number; lastAttemptAt: string | null;
};

export const checkoutScope = (businessId: number, userId: number) => `${businessId}:${userId}`;

// The canonical JSON itself is an exact, collision-free local fingerprint. The server
// stores a SHA-256 of the same canonical JSON for replay checks.
export function canonicalPayload(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalPayload).join(',')}]`;
  const item = value as Record<string, unknown>;
  return `{${Object.keys(item).filter(key => item[key] !== undefined).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalPayload(item[key])}`).join(',')}}`;
}

export const isUnresolved = (command: CheckoutCommand) =>
  command.state !== 'confirmed' && command.state !== 'rejected';

