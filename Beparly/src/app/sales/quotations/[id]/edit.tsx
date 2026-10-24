import { useLocalSearchParams } from 'expo-router';
import { QuotationForm } from '@/features/quotations/quotation-form';
export default function EditQuotation() { const { id } = useLocalSearchParams<{ id: string }>(); return <QuotationForm id={id} />; }
