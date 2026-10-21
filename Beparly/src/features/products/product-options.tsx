import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { toast } from 'tamagui/toast';

import { AppSymbol } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { palette, radius, spacing } from '@/constants/design-system';
import type { Product } from '@/services/api';

const units = ['Piece', 'Kilogram', 'Gram', 'Litre', 'Millilitre', 'Packet', 'Bag', 'Box'];
const tracking = [
  { value: 'simple', label: 'Simple', icon: 'stock' },
  { value: 'batch', label: 'Batch', icon: 'batch' },
  { value: 'expiry', label: 'Expiry', icon: 'warning' },
] as const;

export function StockUnitPicker({ value, onChange, inline = false }: { value: string; onChange: (value: string) => void; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  const unitRows = [...new Set([...units, value])].map((unit) =>
    <Pressable key={unit} accessibilityRole="button" accessibilityState={{ selected: value === unit }}
      onPress={() => { onChange(unit); setOpen(false); }} style={[styles.unitRow, value === unit && styles.selected]}>
      <Text style={styles.value}>{unit}</Text>{value === unit && <AppSymbol name="activate" size={19} color={palette.primary} />}
    </Pressable>);
  return <View style={styles.field}>
    <View style={styles.labelRow}><Text style={styles.label}>Stock counted in *</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="About stock units" onPress={() => toast.info('Choose the base unit used to count this item in stock.')} style={styles.info}><AppSymbol name="info" size={18} color={palette.secondary} /></Pressable></View>
    <Pressable accessibilityRole="button" accessibilityLabel="Choose stock unit" onPress={() => setOpen(true)} style={styles.selector}>
      <AppSymbol name="package" size={19} color={palette.primary} /><Text style={styles.value}>{value}</Text><AppSymbol name="down" size={20} color={palette.secondary} />
    </Pressable>
    {inline && open && <View style={styles.inlineList}>{unitRows}</View>}
    {!inline && <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={styles.backdrop}><View style={styles.modalCard}>
        <View style={styles.modalHeader}><Text style={styles.title}>Stock counted in</Text><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setOpen(false)} style={styles.info}><AppSymbol name="close" size={20} color={palette.secondary} /></Pressable></View>
        <ScrollView contentContainerStyle={styles.unitList}>{unitRows}</ScrollView>
      </View></View>
    </Modal>}
  </View>;
}

export function TrackingPicker({ value, onChange }: { value: Product['tracking_mode']; onChange: (value: Product['tracking_mode']) => void }) {
  return <View style={styles.field}>
    <View style={styles.labelRow}><Text style={styles.label}>Stock tracking</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="About stock tracking" onPress={() => toast.info('Simple counts total stock. Batch records a lot. Expiry also tracks the use-by date.')} style={styles.info}><AppSymbol name="info" size={18} color={palette.secondary} /></Pressable></View>
    <View style={styles.choices}>{tracking.map((option) => <Pressable key={option.value} accessibilityRole="button"
      accessibilityState={{ selected: value === option.value }} onPress={() => onChange(option.value)}
      style={[styles.choice, value === option.value && styles.selected]}>
      <AppSymbol name={option.icon} size={17} color={value === option.value ? palette.primary : palette.secondary} />
      <Text style={styles.choiceText}>{option.label}</Text>
    </Pressable>)}</View>
  </View>;
}

const styles = StyleSheet.create({
  field: { gap: 5 }, labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: palette.ink, fontSize: 14, fontWeight: '600' }, info: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  selector: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm },
  value: { flex: 1, color: palette.ink, fontSize: 15 }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm },
  selected: { borderColor: palette.primary, backgroundColor: palette.primarySoft }, choiceText: { color: palette.ink, fontSize: 13 },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(21,33,31,0.45)' },
  modalCard: { width: '100%', maxWidth: 440, maxHeight: '80%', padding: spacing.lg, borderRadius: radius.md, backgroundColor: palette.surface },
  modalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 }, title: { flex: 1, color: palette.ink, fontSize: 18, fontWeight: '700' },
  unitList: { gap: 8 }, unitRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm },
  inlineList: { gap: 6, paddingTop: 4 },
});
