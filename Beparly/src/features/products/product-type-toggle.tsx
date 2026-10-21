import { Pressable, StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/components/app-text';
import { AppSymbol } from '@/components/app-symbol';
import { palette, radius } from '@/constants/design-system';

type ProductType = 'single' | 'variant';

export function ProductTypeToggle({ value, onChange }: { value: ProductType; onChange: (type: ProductType) => void }) {
  return <View style={styles.group} accessibilityLabel="Product type">
    {(['single', 'variant'] as const).map((type) => <Pressable key={type} accessibilityRole="button"
      accessibilityState={{ selected: value === type }} onPress={() => onChange(type)}
      style={[styles.option, value === type && styles.active]}>
      <AppSymbol name={type === 'single' ? 'package' : 'batch'} size={17} color={value === type ? palette.primaryDeep : palette.secondary} />
      <Text style={[styles.label, value === type && styles.activeLabel]}>{type === 'single' ? 'Single' : 'Variant'}</Text>
    </Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  group: { alignSelf: 'flex-start', flexDirection: 'row', padding: 2, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, backgroundColor: palette.surface },
  option: { minWidth: 84, minHeight: 34, flexDirection: 'row', gap: 5, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  active: { backgroundColor: palette.primarySoft },
  label: { color: palette.secondary, fontWeight: '600' },
  activeLabel: { color: palette.primaryDeep, fontWeight: '700' },
});
