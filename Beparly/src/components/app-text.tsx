import type { ComponentProps } from 'react';
import { StyleSheet, Text as NativeText } from 'react-native';

import { appFontFamily } from '@/constants/design-system';

export function AppText({ style, ...props }: ComponentProps<typeof NativeText>) {
  const weight = StyleSheet.flatten(style)?.fontWeight;
  const fontFamily = Number(weight) >= 700 ? 'BeparlyRobotoBold' : Number(weight) >= 500 ? 'BeparlyRobotoMedium' : appFontFamily;
  return <NativeText {...props} style={[style, { fontFamily, fontWeight: 'normal' }]} />;
}
