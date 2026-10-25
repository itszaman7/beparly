import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/components/app-text';
import { formatBdt } from '@/features/products/product-rules';
import { releaseWebFocus } from './web-focus';
import type { ReportSalePreview } from '@/services/api';

export function openSaleDetail(saleId: string) {
  releaseWebFocus();
  router.push(`/sales/${saleId}/details` as Href);
}

export function SaleLink({ sale, compact = false }: { sale: ReportSalePreview; compact?: boolean }) {
  const products = sale.products.map((line) =>
    `${line.name}${line.variant ? ` / ${line.variant}` : ''} × ${line.quantity} ${line.unit}`).join(', ');
  return <Pressable onPress={() => openSaleDetail(sale.sale_id)} accessibilityRole="link"
    accessibilityLabel={`Open sale ${sale.sale_number} for ${sale.customer_name}`} style={[styles.card, compact && styles.compact]}>
    <View style={styles.heading}><Text style={styles.link}>Sale {sale.sale_number} →</Text>
      {!compact && <Text style={styles.amount}>{formatBdt(sale.sale_total)}</Text>}</View>
    <Text style={styles.customer}>Customer: {sale.customer_name}</Text>
    <Text style={styles.products} numberOfLines={compact ? 2 : 3}>Products: {products || 'No products recorded'}{sale.product_count > sale.products.length ? `, +${sale.product_count - sale.products.length} more` : ''}</Text>
    {!compact && <Text style={styles.meta}>{[sale.posted_date ? `Posted ${sale.posted_date}` : '', sale.invoice_date ? `Invoice ${sale.invoice_date}` : '', sale.sale_status].filter(Boolean).join(' · ')}</Text>}
  </Pressable>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DCE6E2', borderRadius: 12, padding: 13, gap: 5, minHeight: 74 },
  compact: { backgroundColor: '#F4F9F7', padding: 10, minHeight: 60 },
  heading: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  link: { color: '#006D64', fontSize: 13, fontWeight: '800', textDecorationLine: 'underline' },
  amount: { color: '#15211F', fontSize: 13, fontWeight: '800' },
  customer: { color: '#15211F', fontSize: 12, fontWeight: '700' },
  products: { color: '#52635E', fontSize: 11, lineHeight: 16 },
  meta: { color: '#52635E', fontSize: 10 },
});
