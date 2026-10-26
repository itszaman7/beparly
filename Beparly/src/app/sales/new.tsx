import { Redirect } from 'expo-router';

// Older checkout links now enter through the sales list and its sale-type picker.
export default function NewSaleEntry() {
  return <Redirect href="/sales-hub" />;
}
