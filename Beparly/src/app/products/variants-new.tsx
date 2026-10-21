import { Redirect } from 'expo-router';

export default function VariantProductRedirect() {
  return <Redirect href="/products/new?type=variant" />;
}
