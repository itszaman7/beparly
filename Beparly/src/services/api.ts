import { Platform } from 'react-native';

export type Account = {
  user: { id: number; name: string; phone: string };
  business: { id: number; name: string; phone?: string; address?: string; logo_url?: string | null };
  role: 'owner' | 'employee';
};

export type BusinessProfile = Account['business'] & { role: Account['role'] };
export type AuthResult = { token: string; user: Account['user']; businesses: BusinessProfile[] };
export type Employee = { id: number; name: string; phone: string; can_manage_locations: boolean; can_post_stock: boolean };
export type StockLocation = {
  id: number;
  business_id: number;
  name: string;
  type: 'shop' | 'warehouse';
  address: string;
  is_default: boolean;
  is_active: boolean;
};
export type LocationInput = { name: string; type: StockLocation['type']; address: string };
export type Category = { id: string; name: string; parent: string | null; is_active: boolean };
export type Product = {
  id: string; name: string; product_type: 'simple' | 'variant'; variant_count?: number; description: string; specifications?: Record<string, string>; sku: string; barcode: string;
  category: string | null; base_unit: string; purchase_price: string | null;
  retail_price: string | null; wholesale_price: string | null; image_url: string | null;
  minimum_stock: string; tracking_mode: 'simple' | 'batch' | 'expiry';
  is_active: boolean; created_at: string; updated_at: string;
  variants?: Variant[];
  sellable_stock?: string | null; stock_by_unit?: { unit: string; quantity: string }[] | null; low_stock?: boolean; out_of_stock?: boolean;
};
export type Variant = { id: string; label: string; sku: string; barcode: string; base_unit: string;
  purchase_price: string | null; retail_price: string | null; wholesale_price: string | null;
  minimum_stock: string; tracking_mode: Product['tracking_mode']; is_active: boolean; sellable_stock?: string; out_of_stock?: boolean;
  selections: Record<string, string> };
export type VariantInput = { id: string; sku: string; barcode?: string; base_unit: string;
  purchase_price?: string | null; retail_price?: string | null; wholesale_price?: string | null;
  minimum_stock?: string; tracking_mode?: Product['tracking_mode']; selections: Record<string, string>;
  opening_stock?: { quantity: string; unit_cost: string; location_id?: number; lot_code?: string; expires_on?: string } };
export type ProductListOptions = {
  search?: string; page?: number; category?: string;
  active?: 'all' | 'true' | 'false';
  stock?: 'all' | 'in_stock' | 'low_stock' | 'out_of_stock';
  tracking?: 'all' | Product['tracking_mode'];
  sort?: 'name' | 'name_desc' | 'newest' | 'price_asc' | 'price_desc' | 'stock_asc' | 'stock_desc';
};
export type ProductSummary = { active_products: number; low_stock: number; out_of_stock: number };
export type ProductInput = Partial<Pick<Product, 'id' | 'product_type' | 'description' | 'specifications' | 'sku' | 'barcode' | 'category' | 'base_unit' | 'purchase_price' | 'retail_price' | 'wholesale_price' | 'minimum_stock' | 'tracking_mode' | 'is_active'>> & { name: string;
  attributes?: { name: string; values: string[] }[]; variants?: VariantInput[];
  opening_stock?: { quantity: string; unit_cost: string; location_id?: number; lot_code?: string; expires_on?: string } };
export type StockSummary = { physical: string; sellable: string; inventory_value: string; expired: string; expiring_soon: string; locations: { id: number; name: string; quantity: string }[]; stock_by_unit?: { unit: string; quantity: string; physical?: string }[] };
export type LocationOverview = {
  summary: { inventory_value: string; sku_count: number; low_stock_count: number; expiring_soon_count: number };
  inventory: { product_id: string; variant_id: string; sku: string; name: string; unit: string;
    available_quantity: string; physical_quantity: string; stock_value: string | null; purchase_cost: string;
    returning_quantity: null; shortage_quantity: null; low_stock: boolean; expiring_soon: boolean }[];
};
export type LocationMovement = { id: string; product_id: string; variant_id: string; variant_label: string; sku: string; unit: string;
  name: string; type: string; quantity_change: string; created_at: string };
export type ProductUnit = { id: string; name: string; factor: string; selling_price: string | null; barcode: string; is_active: boolean };
export type StockBatch = { id: string; lot_code: string; expires_on: string | null; location_id: number | null; location: string; physical: string; sellable: string; status: 'ok' | 'expired' | 'expiring_soon' };
export type ProductMovement = { id: string; type: string; quantity_change: string; location: string; location_id: number; batch: string | null; batch_id: string | null; reason: string; created_at: string };
export type AuditEvent = { id: string; entity_type: string; entity_id: string; subject: string; location_id: number | null; action: string; changes: Record<string, unknown>; actor: string; created_at: string };
export type MoneyAccount = { id: string; name: string; kind: 'cash' | 'bank' | 'wallet' | 'other'; masked_reference: string; is_default: boolean; is_active: boolean; balance: string; created_at: string };
export type MoneyTransaction = { id: string; kind: string; amount: string; account_id: string; destination_id: string | null; contact_id: string | null; note: string; event_date: string; created_at: string; reversed: boolean };
export type Contact = { id: string; name: string; phone: string; customer_type?: 'regular' | 'wholesale'; address?: string; district?: string; area?: string; notes?: string; is_customer: boolean; is_supplier: boolean; customer_advance: string; supplier_advance: string; to_collect: string; to_pay: string };
export type BusinessAsset = { id: string; name: string; cost: string; residual_value: string; useful_life_months: number; in_service_date: string; sold_on: string | null; depreciated: string; book_value: string };
export type SaleRecord = { id: string; invoice_number: string; customer_id: string | null; customer_name: string; customer_phone?: string; customer_address?: Record<string, string>; location_id: number; mode: 'quick' | 'manual'; price_tier: 'retail' | 'wholesale'; status: string; payment_status: string; cancellation_reason?: string; subtotal: string; discount: string; total: string; paid: string; due: string; created_at: string; invoice_date?: string; billing_address?: Record<string, string>; delivery_address?: Record<string, string>; source?: string; notes?: string; payment_account_names?: string[]; lines?: { product_id: string; variant_id: string; name: string; variant: string; sku: string; unit: string; quantity: string; unit_price: string; line_total: string }[]; payments?: { id: string; amount: string; account_id: string; kind: string; created_at: string }[] };

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function apiBaseUrl() {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new ApiError('API address is missing from this Expo session. Reload the app from the Beparly project.', 0);
  }
  if (!__DEV__ && !baseUrl.startsWith('https://')) {
    throw new ApiError('EXPO_PUBLIC_API_URL must use HTTPS outside development.', 0);
  }
  return baseUrl;
}

async function request<T>(path: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', data?: object, token?: string, commandId?: string): Promise<T> {
  const baseUrl = apiBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/${path}`, {
      method,
      headers: {
        ...(data ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(commandId ? { 'X-Command-ID': commandId } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  } catch {
    throw new ApiError('Could not reach Beparly. Check your connection and API address.', 0);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(result?.error?.message ?? 'Something went wrong. Please try again.', response.status);
  }
  if (!result) throw new ApiError('The server returned an unexpected response.', response.status);
  return result as T;
}

async function uploadImage(token: string, businessId: number, productId: string, uri: string): Promise<{ product: Product }> {
  const data = new FormData();
  if (Platform.OS === 'web' || uri.startsWith('data:')) {
    const blob = await (await fetch(uri)).blob();
    data.append('image', blob, 'product.jpg');
  } else {
    data.append('image', { uri, name: 'product.jpg', type: 'image/jpeg' } as unknown as Blob);
  }
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}/api/v1/businesses/${businessId}/products/${productId}/image/`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: data,
    });
  } catch {
    throw new ApiError('Image upload will retry when connected.', 0);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(result?.error?.message ?? 'Could not upload image.', response.status);
  return result;
}

export const api = {
  register: (data: { username?: string; phone: string; password: string }) =>
    request<AuthResult>('auth/register/', 'POST', data),
  login: (data: { phone: string; password: string }) => request<AuthResult>('auth/login/', 'POST', data),
  me: (token: string) => request<Omit<AuthResult, 'token'>>('auth/me/', 'GET', undefined, token),
  logout: (token: string) => request<{ ok: boolean }>('auth/logout/', 'POST', {}, token),
  businesses: (token: string) => request<{ user: Account['user']; businesses: BusinessProfile[] }>('businesses/', 'GET', undefined, token),
  businessProfile: (token: string, businessId: number) => request<{ business: BusinessProfile }>(`businesses/${businessId}/profile/`, 'GET', undefined, token),
  updateBusinessProfile: (token: string, businessId: number, data: { phone: string; address: string }) => request<{ business: BusinessProfile }>(`businesses/${businessId}/profile/`, 'PATCH', data, token),
  createBusiness: (token: string, name: string, openingCash?: string) => request<{ business: BusinessProfile }>('businesses/', 'POST', { name, ...(openingCash ? { opening_cash: openingCash } : {}) }, token),
  employees: (token: string, businessId: number) => request<{ employees: Employee[] }>(`businesses/${businessId}/employees/`, 'GET', undefined, token),
  createEmployee: (token: string, businessId: number, data: { username?: string; phone: string; password: string }) =>
    request<{ employee: Employee }>(`businesses/${businessId}/employees/`, 'POST', data, token),
  setLocationPermission: (token: string, businessId: number, userId: number, enabled: boolean) =>
    request<{ employee: Employee }>(`businesses/${businessId}/employees/${userId}/permissions/`, 'PATCH', { can_manage_locations: enabled }, token),
  setStockPermission: (token: string, businessId: number, userId: number, enabled: boolean) =>
    request<{ employee: Employee }>(`businesses/${businessId}/employees/${userId}/permissions/`, 'PATCH', { can_post_stock: enabled }, token),
  locations: (token: string, businessId: number) =>
    request<{ locations: StockLocation[]; can_manage_locations: boolean }>(`businesses/${businessId}/locations/`, 'GET', undefined, token),
  location: (token: string, businessId: number, locationId: number) =>
    request<{ location: StockLocation; can_manage_locations: boolean }>(`businesses/${businessId}/locations/${locationId}/`, 'GET', undefined, token),
  createLocation: (token: string, businessId: number, data: LocationInput) =>
    request<{ location: StockLocation }>(`businesses/${businessId}/locations/`, 'POST', data, token),
  updateLocation: (token: string, businessId: number, locationId: number, data: Partial<LocationInput> & { is_active?: boolean }) =>
    request<{ location: StockLocation }>(`businesses/${businessId}/locations/${locationId}/`, 'PATCH', data, token),
  setDefaultLocation: (token: string, businessId: number, locationId: number) =>
    request<{ location: StockLocation }>(`businesses/${businessId}/locations/${locationId}/set-default/`, 'POST', {}, token),
  products: (token: string, businessId: number, options: ProductListOptions = {}) => {
    const query = new URLSearchParams({ search: options.search ?? '', page: String(options.page ?? 1), sort: options.sort ?? 'name' });
    if (options.category) query.set('category', options.category);
    if (options.active && options.active !== 'all') query.set('active', options.active);
    if (options.stock && options.stock !== 'all') query.set('stock', options.stock);
    if (options.tracking && options.tracking !== 'all') query.set('tracking', options.tracking);
    return request<{ products: Product[]; next_page: number | null }>(`businesses/${businessId}/products/?${query.toString()}`, 'GET', undefined, token);
  },
  productSummary: (token: string, businessId: number) =>
    request<ProductSummary>(`businesses/${businessId}/products/summary/`, 'GET', undefined, token),
  product: (token: string, businessId: number, id: string) =>
    request<{ product: Product; stock: StockSummary; variants?: Variant[] }>(`businesses/${businessId}/products/${id}/`, 'GET', undefined, token),
  variant: (token: string, businessId: number, productId: string, variantId: string) =>
    request<{ variant: Variant; stock: StockSummary }>(`businesses/${businessId}/products/${productId}/variants/${variantId}/`, 'GET', undefined, token),
  updateVariant: (token: string, businessId: number, productId: string, variantId: string,
    data: Partial<Pick<Variant, 'sku' | 'barcode' | 'purchase_price' | 'retail_price' | 'wholesale_price' | 'minimum_stock' | 'is_active'>>) =>
    request<{ variant: Variant }>(`businesses/${businessId}/products/${productId}/variants/${variantId}/`, 'PATCH', data, token),
  createProduct: (token: string, businessId: number, data: ProductInput & { opening_stock?: { quantity: string; unit_cost: string; location_id?: number; lot_code?: string; expires_on?: string } }, commandId: string) =>
    request<{ product: Product }>(`businesses/${businessId}/products/`, 'POST', data, token, commandId),
  updateProduct: (token: string, businessId: number, id: string, data: Partial<ProductInput>, commandId?: string) =>
    request<{ product: Product }>(`businesses/${businessId}/products/${id}/`, 'PATCH', data, token, commandId),
  categories: (token: string, businessId: number) =>
    request<{ categories: Category[] }>(`businesses/${businessId}/categories/`, 'GET', undefined, token),
  createCategory: (token: string, businessId: number, name: string, parent: string | null) =>
    request<{ category: Category }>(`businesses/${businessId}/categories/`, 'POST', { name, parent }, token),
  uploadProductImage: uploadImage,
  removeProductImage: (token: string, businessId: number, id: string) =>
    request<{ product: Product }>(`businesses/${businessId}/products/${id}/image/`, 'DELETE', undefined, token),
  manualReceipt: (token: string, businessId: number, data: { product_id: string; variant_id?: string; location_id: number; quantity: string; unit_cost: string; reason: string; financial_reason?: 'owner_contribution' | 'count_gain'; batch_id?: string; unit_id?: string }, commandId: string) =>
    request<{ movement_id: string }>(`businesses/${businessId}/stock/receipts/`, 'POST', data, token, commandId),
  adjustment: (token: string, businessId: number, data: { product_id: string; variant_id?: string; location_id: number; quantity: string; increase: boolean; unit_cost?: string; reason: string; financial_reason?: 'owner_contribution' | 'count_gain' | 'shortage' | 'opening_correction'; opening_movement_id?: string; batch_id?: string; unit_id?: string }, commandId: string) =>
    request<{ movement_id: string }>(`businesses/${businessId}/stock/adjustments/`, 'POST', data, token, commandId),
  locationStock: (token: string, businessId: number, locationId: number) =>
    request<{ stock: { product_id: string; name: string; quantity: string; unit: string }[] }>(`businesses/${businessId}/locations/${locationId}/stock/`, 'GET', undefined, token),
  locationOverview: (token: string, businessId: number, locationId: number) =>
    request<LocationOverview>(`businesses/${businessId}/locations/${locationId}/overview/`, 'GET', undefined, token),
  locationRecentMovements: (token: string, businessId: number, locationId: number, page: number) =>
    request<{ movements: LocationMovement[]; next_page: number | null }>(`businesses/${businessId}/locations/${locationId}/movements/?page=${page}`, 'GET', undefined, token),
  locationMovements: (token: string, businessId: number, locationId: number) =>
    request<{ movements: { id: string; product_id: string; name: string; type: string; quantity_change: string; created_at: string }[] }>(`businesses/${businessId}/locations/${locationId}/movements/`, 'GET', undefined, token),
  productUnits: (token: string, businessId: number, id: string, variantId?: string) =>
    request<{ base_unit: string; units: ProductUnit[] }>(`businesses/${businessId}/products/${id}/units/${variantId ? `?variant_id=${variantId}` : ''}`, 'GET', undefined, token),
  createProductUnit: (token: string, businessId: number, id: string, data: { name: string; factor: string; selling_price?: string | null; variant_id?: string }) =>
    request<{ unit: ProductUnit }>(`businesses/${businessId}/products/${id}/units/`, 'POST', data, token),
  productBatches: (token: string, businessId: number, id: string, variantId?: string) =>
    request<{ batches: StockBatch[] }>(`businesses/${businessId}/products/${id}/batches/${variantId ? `?variant_id=${variantId}` : ''}`, 'GET', undefined, token),
  productMovements: (token: string, businessId: number, id: string, variantId?: string, openingOnly = false) => {
    const query = new URLSearchParams();
    if (variantId) query.set('variant_id', variantId);
    if (openingOnly) query.set('type', 'opening');
    return request<{ movements: ProductMovement[] }>(`businesses/${businessId}/products/${id}/movements/${query.size ? `?${query}` : ''}`, 'GET', undefined, token);
  },
  auditEvents: (token: string, businessId: number, options: { productId?: string; locationId?: number; page?: number } = {}) => {
    const query = new URLSearchParams({ page: String(options.page ?? 1) });
    if (options.productId) query.set('product_id', options.productId);
    if (options.locationId) query.set('location_id', String(options.locationId));
    return request<{ events: AuditEvent[]; next_page: number | null }>(`businesses/${businessId}/audit/?${query.toString()}`, 'GET', undefined, token);
  },
  createBatch: (token: string, businessId: number, id: string, data: { lot_code: string; expires_on?: string | null; variant_id?: string }) =>
    request<{ batch: StockBatch }>(`businesses/${businessId}/products/${id}/batches/`, 'POST', data, token),
  waste: (token: string, businessId: number, data: { product_id: string; variant_id?: string; location_id: number; quantity: string; reason: string; batch_id?: string; unit_id?: string }, commandId: string) =>
    request<{ movement_id: string }>(`businesses/${businessId}/stock/waste/`, 'POST', data, token, commandId),
  transfer: (token: string, businessId: number, data: { product_id: string; variant_id?: string; location_id: number; destination_id: number; quantity: string; batch_id?: string; unit_id?: string }, commandId: string) =>
    request<{ reference_id: string }>(`businesses/${businessId}/stock/transfers/`, 'POST', data, token, commandId),
  fefo: (token: string, businessId: number, id: string, locationId: number) =>
    request<{ recommended_batch_ids: string[] }>(`businesses/${businessId}/products/${id}/fefo/?location_id=${locationId}`, 'GET', undefined, token),
  moneyAccounts: (token: string, businessId: number) =>
    request<{ accounts: MoneyAccount[]; available_money: string }>(`businesses/${businessId}/money/accounts/`, 'GET', undefined, token),
  createMoneyAccount: (token: string, businessId: number, data: { name: string; kind: MoneyAccount['kind']; masked_reference?: string }, commandId: string) =>
    request<{ account: MoneyAccount }>(`businesses/${businessId}/money/accounts/`, 'POST', data, token, commandId),
  moneyTransactions: (token: string, businessId: number) =>
    request<{ transactions: MoneyTransaction[] }>(`businesses/${businessId}/money/transactions/`, 'GET', undefined, token),
  postMoneyTransaction: (token: string, businessId: number, data: { kind: string; amount: string; account_id: string; destination_id?: string; contact_id?: string; category_id?: number; note?: string; event_date?: string }, commandId: string) =>
    request<{ transaction: MoneyTransaction }>(`businesses/${businessId}/money/transactions/`, 'POST', data, token, commandId),
  reverseMoneyTransaction: (token: string, businessId: number, id: string, reason: string, commandId: string) =>
    request<{ reversal_id: string }>(`businesses/${businessId}/money/transactions/${id}/reverse/`, 'POST', { reason }, token, commandId),
  expenseCategories: (token: string, businessId: number) =>
    request<{ categories: { id: number; name: string; type?: string }[] }>(`businesses/${businessId}/money/expense-categories/`, 'GET', undefined, token),
  incomeCategories: (token: string, businessId: number) =>
    request<{ categories: { id: number; name: string; type?: string }[] }>(`businesses/${businessId}/money/income-categories/`, 'GET', undefined, token),
  createFinancialCategory: (token: string, businessId: number, type: 'expense' | 'income', name: string) =>
    request<{ category: { id: number; name: string; type: string } }>(`businesses/${businessId}/money/${type}-categories/`, 'POST', { name, type }, token),
  contacts: (token: string, businessId: number) =>
    request<{ contacts: Contact[] }>(`businesses/${businessId}/contacts/`, 'GET', undefined, token),
  createContact: (token: string, businessId: number, data: { name?: string; phone?: string; customer_type?: 'regular' | 'wholesale'; address?: string; district?: string; area?: string; notes?: string; is_customer: boolean; is_supplier: boolean }) =>
    request<{ contact: Contact }>(`businesses/${businessId}/contacts/`, 'POST', data, token),
  contact: (token: string, businessId: number, id: string) =>
    request<{ contact: Contact; statement: { date: string; description: string; kind: string; debit: string; credit: string }[] }>(`businesses/${businessId}/contacts/${id}/`, 'GET', undefined, token),
  businessAssets: (token: string, businessId: number) =>
    request<{ assets: BusinessAsset[] }>(`businesses/${businessId}/assets/`, 'GET', undefined, token),
  purchaseAsset: (token: string, businessId: number, data: { name: string; cost: string; residual_value: string; useful_life_months: number; in_service_date: string; account_id: string }, commandId: string) =>
    request<{ asset: BusinessAsset }>(`businesses/${businessId}/assets/`, 'POST', data, token, commandId),
  sellAsset: (token: string, businessId: number, id: string, data: { proceeds: string; account_id: string }, commandId: string) =>
    request<{ asset: BusinessAsset }>(`businesses/${businessId}/assets/${id}/sell/`, 'POST', data, token, commandId),
  sales: (token: string, businessId: number) =>
    request<{ sales: SaleRecord[] }>(`businesses/${businessId}/sales/`, 'GET', undefined, token),
  salesOptions: (token: string, businessId: number) =>
    request<{ accounts: MoneyAccount[]; contacts: Contact[]; categories: { id: number; name: string }[] }>(`businesses/${businessId}/sales/options/`, 'GET', undefined, token),
  createSalesIncomeCategory: (token: string, businessId: number, name: string) =>
    request<{ category: { id: number; name: string } }>(`businesses/${businessId}/sales/options/`, 'POST', { name }, token),
  createSalesCustomer: (token: string, businessId: number, data: { phone: string; name?: string; address?: string; district?: string; area?: string; notes?: string }) =>
    request<{ customer: Contact; existing: boolean }>(`businesses/${businessId}/sales/customers/`, 'POST', data, token),
  createSale: (token: string, businessId: number, data: { mode: 'quick' | 'manual'; price_tier: 'retail' | 'wholesale'; location_id: number; income_category_id?: number; customer_id?: string; paid: string; account_id?: string; discount: string; discount_type: 'amount' | 'percent'; billing_address?: Record<string, string>; delivery_address?: Record<string, string>; source?: string; notes?: string; invoice_date?: string; lines: { product_id: string; quantity: string; variant_id?: string }[] }, commandId: string) =>
    request<{ sale: SaleRecord }>(`businesses/${businessId}/sales/`, 'POST', data, token, commandId),
  sale: (token: string, businessId: number, saleId: string) =>
    request<{ sale: SaleRecord }>(`businesses/${businessId}/sales/${saleId}/payments/`, 'GET', undefined, token),
  collectSalePayment: (token: string, businessId: number, saleId: string, data: { amount: string; account_id: string }, commandId: string) =>
    request<{ sale: SaleRecord }>(`businesses/${businessId}/sales/${saleId}/payments/`, 'POST', data, token, commandId),
  cancelSale: (token: string, businessId: number, saleId: string, reason: string, commandId: string) =>
    request<{ sale: SaleRecord }>(`businesses/${businessId}/sales/${saleId}/cancel/`, 'POST', { reason }, token, commandId),
  documentUrl: (businessId: number, saleId: string, kind: 'invoice' | 'receipt') => `${apiBaseUrl()}/api/v1/businesses/${businessId}/sales/${saleId}/documents/${kind}/`,
};
