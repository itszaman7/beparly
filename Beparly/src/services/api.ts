import { Platform } from 'react-native';

export type Account = {
  user: { id: number; name: string; phone: string };
  business: { id: number; name: string; phone?: string; address?: string; logo_url?: string | null; show_currency_symbol?: boolean; invoice_footer_text?: string; label_print_settings?: LabelPrintSettings; timezone?: string };
  role: 'owner' | 'employee';
  can_manage_purchases?: boolean;
};

export type LabelPrintSettings = { paper: '4x6' | '4x6_metric' | '2x4' | 'custom'; width_mm: number; height_mm: number;
  horizontal_offset_mm: number; vertical_offset_mm: number; scale_percent: number; inner_padding_mm: number;
  rotation: 0 | 90 | 180 | 270; safe_margin_mm: number };

export type BusinessProfile = Account['business'] & { role: Account['role']; can_manage_purchases?: boolean };
export type BusinessSwitcherStat = { business_id: number; products: number; locations: number };
export type AuthResult = { token: string; user: Account['user']; businesses: BusinessProfile[] };
export type Employee = { id: number; name: string; phone: string; can_manage_locations: boolean; can_post_stock: boolean; can_manage_purchases: boolean };
export type Supplier = { id: string; name: string; phone: string; address: string; area: string; district: string; notes: string; payment_terms: string; image_url: string | null; to_pay: string; supplier_advance: string; supplier_ledger_id?: string | null; opening_payables?: { id: string; amount: string; paid: string; due: string }[] };
export type PurchaseLineInput = { product_id: string; variant_id?: string; unit_id?: string; batch_id?: string; quantity: string; unit_cost: string };
export type PurchaseCatalogItem = { product_id: string; variant_id: string; name: string; variant_label: string; sku: string; barcode: string; package_barcode_match?: boolean; base_unit: string; tracking_mode: Product['tracking_mode']; image_url: string | null; stock: string; last_purchase_cost: string | null; default_purchase_cost: string | null };
export type PurchaseInput = { supplier_id: string; location_id: number; notes?: string; lines: PurchaseLineInput[] };
export type PurchaseRecord = { id: string; number: string; status: 'draft' | 'completed' | 'cancelled'; supplier_id: string; supplier_name: string; location_id: number; location_name: string; total: string; paid: string; due: string; due_date?: string | null; notes: string; created_at: string; completed_at: string | null; cancellation_reason: string; lines?: (PurchaseLineInput & { id: number; product_name: string; variant_name: string; sku: string; image_url: string | null; base_unit: string; tracking_mode: Product['tracking_mode']; unit_name: string; lot_code: string; base_quantity: string; line_total: string })[]; operations?: { id: string; kind: string; amount: string; created_at: string }[] };
export type RecordAttachment = { id: string; name: string; content_type: string; size: number; created_at: string };
export type PendingAttachment = { commandId: string; uri: string; name: string; contentType: string; size?: number; file?: File };
export type AttachmentKind = 'expense' | 'purchase';
export type SupplierAction = { kind: 'payment' | 'payment_refund' | 'advance' | 'advance_refund' | 'apply_advance' | 'allocation_reversal'; amount: string; account_id?: string; purchase_id?: string; opening_id?: string };
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
export type PurchasePaymentAccount = Pick<MoneyAccount, 'id' | 'name' | 'kind' | 'masked_reference' | 'is_default' | 'is_active' | 'balance'>;
export type MoneyTransaction = { id: string; kind: string; amount: string; account_id: string; destination_id: string | null; contact_id: string | null; note: string; reference: string; event_date: string; created_at: string; reversed: boolean };
export type MoneyLedgerEntry = MoneyTransaction & { debit: string; credit: string; change: string; direction: 'in' | 'out' };
export type FinancialAmounts = { income: string; product_cost: string; other_expenses: string; profit_loss: string };
export type FinancialSummary = { start_date: string; end_date: string; group_by: 'day' | 'month' | 'year'; rows: ({ period: string; has_activity: boolean } & FinancialAmounts)[]; totals: FinancialAmounts; profit_metrics?: { net_sales: string; other_income: string; gross_profit: string }; breakdown: { income: { id: string; name: string; type: string; amount: string }[]; expenses: { id: string; name: string; type: string; amount: string }[] } };
export type ReportResponse = { start_date?: string; end_date?: string; as_of?: string; total?: string; total_quantity?: string; total_cost?: string; total_outstanding?: string; value?: string; ledger_value?: string | null; expired_awaiting_disposal?: string; expired_awaiting_disposal_cost?: string; recognized_write_off_quantity?: string; recognized_write_off_cost?: string; available?: boolean; reason?: string; reconciled?: boolean | null; next_page?: number | null; page?: number; rows?: Record<string, unknown>[]; buckets?: Record<string, string>; advances?: string; groups?: Record<string, { id: string; name: string; amount: string }[]>; assets?: string; liabilities?: string; equity?: string; current_earnings?: string; total_debit?: string; total_credit?: string; opening_balance?: string; closing_balance?: string; account?: { id: string; name: string; type: string }; totals?: FinancialAmounts; profit_metrics?: FinancialSummary['profit_metrics'] };
export type ReportSalePreview = { sale_id: string; sale_number: string; customer_id: string | null; customer_name: string; products: { name: string; variant: string; quantity: string; unit: string }[]; product_count: number; sale_total: string; sale_status: string; posted_date?: string; invoice_date?: string };
export type ReportSalesResponse = { start_date: string | null; end_date: string | null; as_of: string | null; rows: ReportSalePreview[]; page: number; next_page: number | null };
export type SalesHubSummary = { completed_sales: number; collected_against_sales: string; customer_due: string;
  last_seven_days: { date: string; amount: string; count: number }[] };
export type DashboardActivityRecord = { id: string; kind: 'sale' | 'purchase'; number: string; party_name: string;
  amount: string; created_at: string };
export type Contact = { id: string; name: string; phone: string; customer_type?: 'regular' | 'wholesale'; address?: string; district?: string; area?: string; notes?: string; is_customer: boolean; is_supplier: boolean; customer_ledger_id?: string | null; supplier_ledger_id?: string | null; customer_advance: string; supplier_advance: string; to_collect: string; to_pay: string };
export type SaleRecord = { id: string; invoice_number: string; quotation_id?: string | null; customer_id: string | null; customer_name: string; customer_phone?: string; customer_address?: Record<string, string>; location_id: number; mode: 'quick' | 'manual'; price_tier: 'retail' | 'wholesale'; status: string; payment_status: string; due_date?: string | null; cancellation_reason?: string; subtotal: string; discount: string; delivery_fee?: string; total: string; net_total?: string; returned_amount?: string; paid: string; due: string; purchase_cost?: string; profit?: string; item_count?: number; item_quantity?: string; created_at: string; invoice_date?: string; billing_address?: Record<string, string>; delivery_address?: Record<string, string>; source?: string; notes?: string; payment_account_names?: string[]; lines?: { id: number; product_id: string; variant_id: string; name: string; variant: string; sku: string; unit: string; quantity: string; returned_quantity?: string; unit_price: string; inventory_cost?: string; image_url?: string; line_total: string }[]; payments?: { id: string; amount: string; account_id: string; account_name?: string; kind: string; created_at: string }[]; returns?: { id: string; reason: string; amount: string; due_reduction: string; refund_amount: string; refund_account_name: string | null; created_at: string; lines: { line_id: number; quantity: string; condition: 'sellable' | 'damaged' }[] }[] };
export type QuotationLineInput = { product_id: string; variant_id?: string; unit_id?: string | null; quantity: string; unit_price?: string };
export type QuotationInput = { version?: number; customer_id?: string | null; customer_name?: string; customer_phone?: string; customer_address?: string; location_id: number; price_tier: 'retail' | 'wholesale'; valid_until?: string | null; delivery_address?: string; notes?: string; discount: string; delivery_fee: string; lines: QuotationLineInput[] };
export type QuotationRecord = { id: string; number: string; status: 'draft' | 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired'; version: number; sale_id: string | null; customer_id: string | null; customer_name: string; customer_phone: string; customer_address: string; location_id: number; location_name?: string; price_tier: 'retail' | 'wholesale'; valid_until: string | null; issued_at: string | null; delivery_address: string; notes: string; subtotal: string; discount: string; delivery_fee: string; total: string; created_at: string; updated_at: string; lines?: (QuotationLineInput & { id: number; product_name: string; variant_name: string; image_url?: string; sku: string; unit_name: string; conversion_factor: string; base_quantity: string; line_total: string; unit_price: string })[] };
export type QuotationSaleDraft = { id: string; quotation_id: string; payload: QuotationInput };

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

export function resolveAssetUrl(value: string | null | undefined) {
  if (!value) return null;
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  return `${apiBaseUrl()}${value.startsWith('/') ? '' : '/'}${value}`;
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

async function uploadRecordAttachment(token: string, businessId: number, kind: AttachmentKind, recordId: string, item: PendingAttachment) {
  const data = new FormData();
  if (Platform.OS === 'web') {
    data.append('file', item.file ?? await (await fetch(item.uri)).blob(), item.name);
  } else {
    data.append('file', { uri: item.uri, name: item.name, type: item.contentType } as unknown as Blob);
  }
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}/api/v1/businesses/${businessId}/attachments/${kind}/${recordId}/`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-Command-ID': item.commandId }, body: data,
    });
  } catch { throw new ApiError('Document upload failed. Check your connection and retry.', 0); }
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(result?.error?.message ?? 'Could not upload document.', response.status);
  return result as { attachment: RecordAttachment };
}

async function downloadRecordAttachment(token: string, businessId: number, kind: AttachmentKind, recordId: string, attachmentId: string) {
  const response = await fetch(`${apiBaseUrl()}/api/v1/businesses/${businessId}/attachments/${kind}/${recordId}/${attachmentId}/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new ApiError(result?.error?.message ?? 'Could not open document.', response.status);
  }
  return response;
}

async function uploadSupplierImage(token: string, businessId: number, supplierId: string, uri: string): Promise<{ supplier: Supplier }> {
  const data = new FormData();
  if (Platform.OS === 'web' || uri.startsWith('data:')) {
    data.append('image', await (await fetch(uri)).blob(), 'supplier.jpg');
  } else {
    data.append('image', { uri, name: 'supplier.jpg', type: 'image/jpeg' } as unknown as Blob);
  }
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}/api/v1/businesses/${businessId}/suppliers/${supplierId}/image/`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: data,
    });
  } catch { throw new ApiError('Supplier photo upload failed. Try again when connected.', 0); }
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(result?.error?.message ?? 'Could not upload supplier photo.', response.status);
  return result;
}

async function uploadBusinessLogo(token: string, businessId: number, uri: string): Promise<{ logo_url: string | null }> {
  const data = new FormData();
  if (Platform.OS === 'web' || uri.startsWith('data:')) {
    data.append('image', await (await fetch(uri)).blob(), 'shop-logo.jpg');
  } else {
    data.append('image', { uri, name: 'shop-logo.jpg', type: 'image/jpeg' } as unknown as Blob);
  }
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}/api/v1/businesses/${businessId}/logo/`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: data,
    });
  } catch { throw new ApiError('Logo upload failed. Check your connection.', 0); }
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(result?.error?.message ?? 'Could not upload the logo.', response.status);
  return result;
}

export const api = {
  expense: (token: string, businessId: number, transactionId: string) =>
    request<{ transaction: MoneyTransaction & { category_name: string; account_name: string } }>(
      `businesses/${businessId}/money/expenses/${transactionId}/`, 'GET', undefined, token),
  recordAttachments: (token: string, businessId: number, kind: AttachmentKind, recordId: string) =>
    request<{ attachments: RecordAttachment[] }>(`businesses/${businessId}/attachments/${kind}/${recordId}/`, 'GET', undefined, token),
  uploadRecordAttachment,
  downloadRecordAttachment,
  quotations: (token: string, businessId: number, search = '', page = 1) =>
    request<{ quotations: QuotationRecord[]; next_page: number | null }>(`businesses/${businessId}/quotations/?search=${encodeURIComponent(search)}&page=${page}`, 'GET', undefined, token),
  quotation: (token: string, businessId: number, id: string) =>
    request<{ quotation: QuotationRecord }>(`businesses/${businessId}/quotations/${id}/`, 'GET', undefined, token),
  saveQuotation: (token: string, businessId: number, data: QuotationInput, commandId: string, id?: string) =>
    request<{ quotation: QuotationRecord }>(`businesses/${businessId}/quotations/${id ? `${id}/` : ''}`, id ? 'PATCH' : 'POST', data, token, commandId),
  quotationAction: (token: string, businessId: number, id: string, action: 'issue' | 'status' | 'duplicate' | 'convert', data: object, commandId: string) =>
    request<{ quotation?: QuotationRecord; sale_draft?: QuotationSaleDraft }>(`businesses/${businessId}/quotations/${id}/${action}/`, 'POST', data, token, commandId),
  quotationCheckout: (token: string, businessId: number, draftId: string, data: { paid: string; due_date?: string; account_id?: string; customer_id?: string; batch_ids?: (string | null)[]; prices?: string[] }, commandId: string) =>
    request<{ sale: SaleRecord }>(`businesses/${businessId}/quotation-sale-drafts/${draftId}/`, 'POST', data, token, commandId),
  quotationDocumentUrl: (businessId: number, id: string, size: 'a4' | 'a5') => `${apiBaseUrl()}/api/v1/businesses/${businessId}/quotations/${id}/documents/${size}/`,
  register: (data: { username?: string; phone: string; password: string }) =>
    request<AuthResult>('auth/register/', 'POST', data),
  login: (data: { phone: string; password: string }) => request<AuthResult>('auth/login/', 'POST', data),
  me: (token: string) => request<Omit<AuthResult, 'token'>>('auth/me/', 'GET', undefined, token),
  logout: (token: string) => request<{ ok: boolean }>('auth/logout/', 'POST', {}, token),
  businesses: (token: string) => request<{ user: Account['user']; businesses: BusinessProfile[] }>('businesses/', 'GET', undefined, token),
  businessSwitcherSummary: (token: string) => request<{ businesses: BusinessSwitcherStat[] }>('businesses/switcher-summary/', 'GET', undefined, token),
  dashboardActivity: (token: string, businessId: number) =>
    request<{ activity: DashboardActivityRecord[] }>(`businesses/${businessId}/dashboard-activity/`, 'GET', undefined, token),
  businessProfile: (token: string, businessId: number) => request<{ business: BusinessProfile }>(`businesses/${businessId}/profile/`, 'GET', undefined, token),
  updateBusinessProfile: (token: string, businessId: number, data: { phone?: string; address?: string; show_currency_symbol?: boolean; invoice_footer_text?: string; label_print_settings?: LabelPrintSettings }) => request<{ business: BusinessProfile }>(`businesses/${businessId}/profile/`, 'PATCH', data, token),
  labelCalibrationUrl: (businessId: number) => `${apiBaseUrl()}/api/v1/businesses/${businessId}/label-calibration/`,
  uploadBusinessLogo,
  removeBusinessLogo: (token: string, businessId: number) => request<{ logo_url: null }>(`businesses/${businessId}/logo/`, 'DELETE', undefined, token),
  createBusiness: (token: string, name: string, openingCash?: string) => request<{ business: BusinessProfile }>('businesses/', 'POST', { name, ...(openingCash ? { opening_cash: openingCash } : {}) }, token),
  employees: (token: string, businessId: number) => request<{ employees: Employee[] }>(`businesses/${businessId}/employees/`, 'GET', undefined, token),
  createEmployee: (token: string, businessId: number, data: { username?: string; phone: string; password: string }) =>
    request<{ employee: Employee }>(`businesses/${businessId}/employees/`, 'POST', data, token),
  setLocationPermission: (token: string, businessId: number, userId: number, enabled: boolean) =>
    request<{ employee: Employee }>(`businesses/${businessId}/employees/${userId}/permissions/`, 'PATCH', { can_manage_locations: enabled }, token),
  setStockPermission: (token: string, businessId: number, userId: number, enabled: boolean) =>
    request<{ employee: Employee }>(`businesses/${businessId}/employees/${userId}/permissions/`, 'PATCH', { can_post_stock: enabled }, token),
  setPurchasePermission: (token: string, businessId: number, userId: number, enabled: boolean) =>
    request<{ employee: Employee }>(`businesses/${businessId}/employees/${userId}/permissions/`, 'PATCH', { can_manage_purchases: enabled }, token),
  suppliers: (token: string, businessId: number, page = 1, search = '') =>
    request<{ suppliers: Supplier[]; next_page: number | null }>(`businesses/${businessId}/suppliers/?page=${page}&search=${encodeURIComponent(search)}`, 'GET', undefined, token),
  supplier: (token: string, businessId: number, id: string) =>
    request<{ supplier: Supplier }>(`businesses/${businessId}/suppliers/${id}/`, 'GET', undefined, token),
  createSupplier: (token: string, businessId: number, data: Partial<Supplier> & { name: string; opening_payable?: string }, commandId: string) =>
    request<{ supplier: Supplier }>(`businesses/${businessId}/suppliers/`, 'POST', data, token, commandId),
  updateSupplier: (token: string, businessId: number, id: string, data: Partial<Supplier>) =>
    request<{ supplier: Supplier }>(`businesses/${businessId}/suppliers/${id}/`, 'PATCH', data, token),
  uploadSupplierImage,
  removeSupplierImage: (token: string, businessId: number, id: string) =>
    request<{ supplier: Supplier }>(`businesses/${businessId}/suppliers/${id}/image/`, 'DELETE', undefined, token),
  supplierActivity: (token: string, businessId: number, id: string, page = 1) =>
    request<{ activity: { id: number; description: string; account: string; debit: string; credit: string; created_at: string }[]; next_page: number | null }>(`businesses/${businessId}/suppliers/${id}/operations/?page=${page}`, 'GET', undefined, token),
  supplierAction: (token: string, businessId: number, id: string, data: SupplierAction, commandId: string) =>
    request<{ operation: { id: string; kind: string; amount: string } }>(`businesses/${businessId}/suppliers/${id}/operations/`, 'POST', data, token, commandId),
  purchases: (token: string, businessId: number, page = 1, supplierId?: string) =>
    request<{ purchases: PurchaseRecord[]; next_page: number | null }>(`businesses/${businessId}/purchases/?page=${page}${supplierId ? `&supplier_id=${supplierId}` : ''}`, 'GET', undefined, token),
  purchasePaymentAccounts: (token: string, businessId: number) =>
    request<{ accounts: PurchasePaymentAccount[] }>(`businesses/${businessId}/purchases/payment-accounts/`, 'GET', undefined, token),
  purchase: (token: string, businessId: number, id: string) =>
    request<{ purchase: PurchaseRecord }>(`businesses/${businessId}/purchases/${id}/`, 'GET', undefined, token),
  createPurchase: (token: string, businessId: number, data: PurchaseInput, commandId: string) =>
    request<{ purchase: PurchaseRecord }>(`businesses/${businessId}/purchases/`, 'POST', data, token, commandId),
  updatePurchase: (token: string, businessId: number, id: string, data: PurchaseInput, commandId: string) =>
    request<{ purchase: PurchaseRecord }>(`businesses/${businessId}/purchases/${id}/`, 'PATCH', data, token, commandId),
  completePurchase: (token: string, businessId: number, id: string, data: { paid: string; account_id?: string; due_date?: string }, commandId: string) =>
    request<{ purchase: PurchaseRecord }>(`businesses/${businessId}/purchases/${id}/complete/`, 'POST', data, token, commandId),
  cancelPurchase: (token: string, businessId: number, id: string, reason: string, commandId: string) =>
    request<{ purchase: PurchaseRecord }>(`businesses/${businessId}/purchases/${id}/cancel/`, 'POST', { reason }, token, commandId),
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
  purchaseCatalog: (token: string, businessId: number, search = '', page = 1) =>
    request<{ items: PurchaseCatalogItem[]; next_page: number | null }>(`businesses/${businessId}/products/purchase-catalog/?search=${encodeURIComponent(search)}&page=${page}`, 'GET', undefined, token),
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
    request<{ accounts: MoneyAccount[]; available_money: string; ledger_accounts: { id: string; code?: string; name: string; type: string; system_managed?: boolean; balance: string }[]; party_accounts: { id: string; code: string; name: string; type: string; balance: string; contact_id: string; contact_name: string; party_type: 'customer' | 'supplier' }[]; income_accounts: { id: string; name: string; balance: string }[]; posted_revenue: string }>(`businesses/${businessId}/money/accounts/`, 'GET', undefined, token),
  createMoneyAccount: (token: string, businessId: number, data: { name: string; kind: MoneyAccount['kind']; masked_reference?: string; opening_balance?: string }, commandId: string) =>
    request<{ account: MoneyAccount }>(`businesses/${businessId}/money/accounts/`, 'POST', data, token, commandId),
  moneyTransactions: (token: string, businessId: number) =>
    request<{ transactions: MoneyTransaction[] }>(`businesses/${businessId}/money/transactions/`, 'GET', undefined, token),
  moneyAccountLedger: (token: string, businessId: number, accountId: string, startDate?: string, endDate?: string) => {
    const query = new URLSearchParams(); if (startDate) query.set('start_date', startDate); if (endDate) query.set('end_date', endDate);
    return request<{ account: MoneyAccount & { type?: string }; opening_balance: string; total_in: string; total_out: string; total_debit: string; total_credit: string; change: string; closing_balance: string; transactions: MoneyLedgerEntry[]; truncated: boolean }>(`businesses/${businessId}/money/accounts/${accountId}/ledger/${query.size ? `?${query}` : ''}`, 'GET', undefined, token);
  },
  financialSummary: (token: string, businessId: number, startDate: string, endDate: string, groupBy: 'day' | 'month' | 'year') =>
    request<FinancialSummary>(`businesses/${businessId}/reports/financial-summary/?start_date=${startDate}&end_date=${endDate}&group_by=${groupBy}`, 'GET', undefined, token),
  report: (token: string, businessId: number, name: string, params: URLSearchParams) =>
    request<ReportResponse>(`businesses/${businessId}/reports/${name}/?${params}`, 'GET', undefined, token),
  reportSales: (token: string, businessId: number, params: URLSearchParams) =>
    request<ReportSalesResponse>(`businesses/${businessId}/reports/sales/?${params}`, 'GET', undefined, token),
  rescheduleDue: (token: string, businessId: number, kind: 'sale' | 'purchase', id: string, dueDate: string, reason: string, commandId: string) =>
    request<{ change_id: number; due_date: string; effective_on: string }>(`businesses/${businessId}/dues/${kind}/${id}/reschedule/`, 'POST', { due_date: dueDate, reason }, token, commandId),
  postMoneyTransaction: (token: string, businessId: number, data: { kind: string; amount: string; account_id: string; destination_id?: string; contact_id?: string; category_id?: number; note?: string; reference?: string; event_date?: string }, commandId: string) =>
    request<{ transaction: MoneyTransaction }>(`businesses/${businessId}/money/transactions/`, 'POST', data, token, commandId),
  reverseMoneyTransaction: (token: string, businessId: number, id: string, reason: string, commandId: string) =>
    request<{ reversal_id: string }>(`businesses/${businessId}/money/transactions/${id}/reverse/`, 'POST', { reason }, token, commandId),
  expenseCategories: (token: string, businessId: number) =>
    request<{ categories: { id: number; name: string; type?: string }[] }>(`businesses/${businessId}/money/expense-categories/`, 'GET', undefined, token),
  incomeCategories: (token: string, businessId: number) =>
    request<{ categories: { id: number; name: string; type?: string }[] }>(`businesses/${businessId}/money/income-categories/`, 'GET', undefined, token),
  createFinancialCategory: (token: string, businessId: number, type: 'expense' | 'income', name: string) =>
    request<{ category: { id: number; name: string; type: string } }>(`businesses/${businessId}/money/${type}-categories/`, 'POST', { name, type }, token),
  contacts: (token: string, businessId: number, page = 1, search = '', role: 'all' | 'customer' | 'supplier' = 'all') =>
    request<{ contacts: Contact[]; next_page: number | null }>(`businesses/${businessId}/contacts/?page=${page}&search=${encodeURIComponent(search)}&role=${role}`, 'GET', undefined, token),
  createContact: (token: string, businessId: number, data: { name?: string; phone?: string; customer_type?: 'regular' | 'wholesale'; address?: string; district?: string; area?: string; notes?: string; is_customer: boolean; is_supplier: boolean }) =>
    request<{ contact: Contact }>(`businesses/${businessId}/contacts/`, 'POST', data, token),
  contact: (token: string, businessId: number, id: string) =>
    request<{ contact: Contact; statement: { date: string; description: string; kind: string; debit: string; credit: string }[] }>(`businesses/${businessId}/contacts/${id}/`, 'GET', undefined, token),
  sales: (token: string, businessId: number, customerId?: string) =>
    request<{ sales: SaleRecord[] }>(`businesses/${businessId}/sales/${customerId ? `?customer_id=${encodeURIComponent(customerId)}` : ''}`, 'GET', undefined, token),
  salesHubSummary: (token: string, businessId: number) =>
    request<SalesHubSummary>(`businesses/${businessId}/sales/hub-summary/`, 'GET', undefined, token),
  salesOptions: (token: string, businessId: number, includeContacts = true) =>
    request<{ accounts: MoneyAccount[]; contacts: Contact[]; categories: { id: number; name: string }[] }>(`businesses/${businessId}/sales/options/${includeContacts ? '' : '?include_contacts=false'}`, 'GET', undefined, token),
  createSalesIncomeCategory: (token: string, businessId: number, name: string) =>
    request<{ category: { id: number; name: string } }>(`businesses/${businessId}/sales/options/`, 'POST', { name }, token),
  createSalesCustomer: (token: string, businessId: number, data: { phone: string; name?: string; address?: string; district?: string; area?: string; notes?: string }) =>
    request<{ customer: Contact; existing: boolean }>(`businesses/${businessId}/sales/customers/`, 'POST', data, token),
  quotationCustomers: (token: string, businessId: number, search = '', page = 1) =>
    request<{ customers: Pick<Contact, 'id' | 'name' | 'phone' | 'address' | 'area' | 'district'>[]; next_page: number | null }>(`businesses/${businessId}/sales/customers/?search=${encodeURIComponent(search)}&page=${page}`, 'GET', undefined, token),
  createSale: (token: string, businessId: number, data: { mode: 'quick' | 'manual'; price_tier: 'retail' | 'wholesale'; location_id: number; income_category_id?: number; customer_id?: string; paid: string; due_date?: string; account_id?: string; discount: string; discount_type: 'amount' | 'percent'; delivery_fee?: string; billing_address?: Record<string, string>; delivery_address?: string; source?: string; notes?: string; invoice_date?: string; lines: { product_id: string; quantity: string; variant_id?: string }[] }, commandId: string) =>
    request<{ sale: SaleRecord }>(`businesses/${businessId}/sales/`, 'POST', data, token, commandId),
  sale: (token: string, businessId: number, saleId: string) =>
    request<{ sale: SaleRecord }>(`businesses/${businessId}/sales/${saleId}/payments/`, 'GET', undefined, token),
  collectSalePayment: (token: string, businessId: number, saleId: string, data: { amount: string; account_id: string }, commandId: string) =>
    request<{ sale: SaleRecord }>(`businesses/${businessId}/sales/${saleId}/payments/`, 'POST', data, token, commandId),
  cancelSale: (token: string, businessId: number, saleId: string, reason: string, commandId: string) =>
    request<{ sale: SaleRecord }>(`businesses/${businessId}/sales/${saleId}/cancel/`, 'POST', { reason }, token, commandId),
  returnSale: (token: string, businessId: number, saleId: string, data: { reason: string; refund_account_id?: string; lines: { line_id: number; quantity: string; condition: 'sellable' | 'damaged' }[] }, commandId: string) =>
    request<{ sale: SaleRecord; return_id: string }>(`businesses/${businessId}/sales/${saleId}/returns/`, 'POST', data, token, commandId),
  documentUrl: (businessId: number, saleId: string, kind: 'invoice' | 'receipt' | 'label') => `${apiBaseUrl()}/api/v1/businesses/${businessId}/sales/${saleId}/documents/${kind}/`,
};
