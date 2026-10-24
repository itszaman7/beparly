import React, { type ComponentProps } from 'react';
import { StyleSheet, Text as NativeText } from 'react-native';

import { appFontFamily } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';

function applyCurrencyPreference(node: React.ReactNode, showCurrencySymbol: boolean): React.ReactNode {
  if (typeof node === 'string') return showCurrencySymbol ? node : node.replaceAll('৳', '');
  if (Array.isArray(node)) return node.map((item) => applyCurrencyPreference(item, showCurrencySymbol));
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return React.cloneElement(node, {}, applyCurrencyPreference(node.props.children, showCurrencySymbol));
  }
  return node;
}

export function AppText({ style, ...props }: ComponentProps<typeof NativeText>) {
  const { session } = useAuth();
  const showCurrencySymbol = session?.account?.business.show_currency_symbol ?? true;
  const weight = StyleSheet.flatten(style)?.fontWeight;
  const fontFamily = Number(weight) >= 700 ? 'BeparlyRobotoBold' : Number(weight) >= 500 ? 'BeparlyRobotoMedium' : appFontFamily;
  return <NativeText {...props} style={[style, { fontFamily, fontWeight: 'normal' }]}>{applyCurrencyPreference(props.children, showCurrencySymbol)}</NativeText>;
}
