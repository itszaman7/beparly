import { Redirect, useLocalSearchParams } from 'expo-router';
import { QuotationForm } from '@/features/quotations/quotation-form';
export default function NewQuotation() {
  const { tier, draft } = useLocalSearchParams<{ tier?: string; draft?: string }>();
  if (tier !== 'retail' && tier !== 'wholesale') return <Redirect href="/sales/quotations" />;
  return <QuotationForm initialTier={tier} draftKey={draft} />;
}
