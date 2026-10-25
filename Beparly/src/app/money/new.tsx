import { useLocalSearchParams } from 'expo-router';

import { MoneyInScreen } from '@/features/money/money-in';
import { ExpenseScreen } from '@/features/money/expense';
import { MoneyForm } from '@/features/money/money-ui';

export default function NewMoneyScreen() {
  const { flow } = useLocalSearchParams<{ flow?: string }>();
  return flow === 'expense' ? <ExpenseScreen /> : flow === 'out' || flow === 'transfer' ? <MoneyForm /> : <MoneyInScreen />;
}
