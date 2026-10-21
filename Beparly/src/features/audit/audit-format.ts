import type { AuditEvent } from '@/services/api';
import { formatBdt } from '@/features/products/product-rules';

const fields: Record<string, string> = {
  name: 'Name', description: 'Description', sku: 'SKU', barcode: 'Barcode',
  category_id: 'Category', base_unit: 'Base unit', purchase_price: 'Buying price',
  retail_price: 'Selling price', wholesale_price: 'Wholesale price',
  minimum_stock: 'Low stock alert', tracking_mode: 'Stock tracking',
  is_active: 'Status', parent_id: 'Parent category', factor: 'Conversion',
  image: 'Photo',
  selling_price: 'Package price', lot_code: 'Batch number',
  manufactured_on: 'Manufacturing date', expires_on: 'Expiry date',
  type: 'Location type', address: 'Address', is_default: 'Default location',
};

const actionNames: Record<string, string> = {
  opening: 'Opening stock', manual_receipt: 'Stock added', adjustment: 'Stock adjusted',
  waste: 'Waste recorded', transfer: 'Stock transferred',
  tracking_changed: 'Stock tracking changed', image_added: 'Photo added',
  image_replaced: 'Photo replaced', image_removed: 'Photo removed',
};

const entityNames: Record<string, string> = {
  product: 'Product', category: 'Category', package: 'Packaging unit',
  batch: 'Batch', location: 'Location', stock: 'Stock',
};

export function auditTitle(event: AuditEvent) {
  if (actionNames[event.action]) return actionNames[event.action];
  const entity = entityNames[event.entity_type] ?? 'Record';
  if (event.action === 'created') return `${entity} added`;
  if (event.action === 'deactivated') return `${entity} deactivated`;
  if (event.action === 'activated') return `${entity} reactivated`;
  return `${entity} updated`;
}

export function auditDetails(event: AuditEvent) {
  if (event.entity_type === 'stock') {
    const amount = event.changes.quantity_change;
    const signed = typeof amount === 'string' ? amount.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : '';
    const location = event.changes.location;
    const reason = event.changes.reason;
    return [signed ? `${signed.startsWith('-') ? '' : '+'}${signed}` : '', location, reason]
      .filter((item) => typeof item === 'string' && item.length > 0).join(' · ');
  }
  if (event.action === 'updated' || event.action === 'activated' || event.action === 'deactivated' || event.action === 'tracking_changed') {
    const changed = Object.keys(event.changes).map((key) => fields[key] ?? key.replace(/_/g, ' '));
    return changed.length ? changed.join(', ') + ' changed' : event.subject;
  }
  return event.subject;
}

export function auditChanges(event: AuditEvent) {
  if (event.entity_type === 'stock') return [];
  return Object.entries(event.changes).flatMap(([key, raw]) => {
    if (key === 'after' || !raw || typeof raw !== 'object' || !('before' in raw) || !('after' in raw)) return [];
    const change = raw as { before: unknown; after: unknown };
    const label = fields[key] ?? key.replace(/_/g, ' ');
    if (key.endsWith('_id')) return [`${label} changed`];
    const display = (value: unknown) => {
      if (value === null || value === '') return 'Not set';
      if (typeof value === 'boolean') return value ? 'Yes' : 'No';
      if (typeof value === 'string' && (key.includes('price'))) return formatBdt(value);
      return String(value);
    };
    return [`${label}: ${display(change.before)} → ${display(change.after)}`];
  });
}
