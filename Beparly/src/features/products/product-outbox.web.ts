import type { ProductInput } from '@/services/api';

export async function stageProductImage(uri: string) { return uri; }
export async function queueProduct(_commandId: string, _businessId: number, _kind: 'create' | 'update', _productId: string | null, _input: ProductInput, _imageUri: string | null) {
  throw new Error('Offline product saving is available in the Android app.');
}
export async function pendingProducts(_businessId: number) { return []; }
export async function cancelProduct(_commandId: string) { return; }
export async function syncProducts(_token: string, _businessId: number) { return 0; }
export async function cacheConfirmedStock(_businessId: number, _productId: string, _variantId: string | undefined, _locationId: number, _batchId: string | undefined, _quantity: string) { return; }
export async function queueStock(_commandId: string, _businessId: number, _kind: 'adjustment' | 'waste' | 'transfer' | 'receipt', _payload: object, _baseQuantity: string) { throw new Error('Offline stock saving is available in the Android app.'); }
export async function pendingStock(_businessId: number) { return []; }
export async function cancelStock(_commandId: string) { return; }
export async function correctStock(_commandId: string, _replacementId: string, _quantity: string) { throw new Error('Offline stock saving is available in the Android app.'); }
export async function syncStock(_token: string, _businessId: number) { return 0; }
