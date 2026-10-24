import { useLocalSearchParams } from 'expo-router';

import { MoneyInScreen } from '@/features/money/money-in';
import { MoneyForm } from '@/features/money/money-ui';

export default function NewMoneyScreen() {
  const { flow } = useLocalSearchParams<{ flow?: string }>();
  return flow === 'out' || flow === 'transfer' || flow === 'expense' ? <MoneyForm /> : <MoneyInScreen />;
}
