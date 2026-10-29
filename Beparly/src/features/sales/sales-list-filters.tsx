import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/components/app-text';
import { DateField } from '@/components/date-field';
import { palette } from '@/constants/design-system';
import { X } from '@/components/sales-icons';
import { defaultSalesFilters, type SalesFilters, type SalesPeriod, type SalesTier } from './sales-list-rules';

const periods: { value: SalesPeriod; label: string }[] = [
  { value: 'all', label: 'All time' }, { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom date range' },
];
const tiers: { value: SalesTier; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'retail', label: 'Retail' }, { value: 'wholesale', label: 'Wholesale' },
];

export function salesPeriodLabel(period: SalesPeriod) {
  return periods.find((option) => option.value === period)?.label ?? 'All time';
}

export function SalesFilterSheet({ value, onClose, onApply }: {
  value: SalesFilters; onClose: () => void; onApply: (value: SalesFilters) => void;
}) {
  const [draft, setDraft] = useState(value);
  const invalidRange = draft.period === 'custom' && (!draft.start || !draft.end || draft.start > draft.end);
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close filters" />
      <View style={styles.sheet}>
        <View style={styles.heading}><Text style={styles.title}>Filter sales</Text><Pressable style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close filters"><X size={20} color={palette.ink} /></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <Text style={styles.label}>Period</Text>
          <View style={styles.periodGrid}>{periods.map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: draft.period === option.value }}
            onPress={() => setDraft((current) => ({ ...current, period: option.value }))} style={[styles.option, draft.period === option.value && styles.selected]}>
            <Text style={[styles.optionText, draft.period === option.value && styles.selectedText]}>{option.label}</Text>
          </Pressable>)}</View>
          {draft.period === 'custom' && <View style={styles.dates}>
            <View style={styles.date}><Text style={styles.label}>From</Text><DateField label="Sales start date" value={draft.start} onChange={(start) => setDraft((current) => ({ ...current, start }))} /></View>
            <View style={styles.date}><Text style={styles.label}>To</Text><DateField label="Sales end date" value={draft.end} onChange={(end) => setDraft((current) => ({ ...current, end }))} /></View>
            {draft.start && draft.end && draft.start > draft.end ? <Text style={styles.error}>End date must be on or after start date.</Text> : null}
          </View>}
          <Text style={styles.label}>Sale type</Text>
          <View style={styles.segment}>{tiers.map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: draft.tier === option.value }}
            onPress={() => setDraft((current) => ({ ...current, tier: option.value }))} style={[styles.segmentOption, draft.tier === option.value && styles.segmentSelected]}>
            <Text style={[styles.optionText, draft.tier === option.value && styles.selectedText]}>{option.label}</Text>
          </Pressable>)}</View>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: draft.dueOnly }} onPress={() => setDraft((current) => ({ ...current, dueOnly: !current.dueOnly }))} style={styles.dueRow}>
            <View style={[styles.check, draft.dueOnly && styles.checkSelected]}>{draft.dueOnly ? <Text style={styles.checkMark}>✓</Text> : null}</View>
            <Text style={styles.dueText}>Unpaid invoices only</Text>
          </Pressable>
        </ScrollView>
        <View style={styles.footer}>
          <Pressable accessibilityRole="button" onPress={() => setDraft(defaultSalesFilters)} style={styles.reset}><Text style={styles.resetText}>Reset</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={invalidRange} onPress={() => onApply(draft)} style={[styles.apply, invalidRange && styles.disabled]}><Text style={styles.applyText}>Show sales</Text></Pressable>
        </View>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,25,22,.45)' },
  sheet: { width: '100%', maxWidth: 620, maxHeight: '88%', alignSelf: 'center', backgroundColor: palette.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  heading: { minHeight: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: palette.border },
  title: { color: palette.ink, fontSize: 20, fontWeight: '800' }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, gap: 12 }, label: { color: palette.secondary, fontSize: 13, fontWeight: '700' },
  periodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, option: { minHeight: 44, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: palette.border, justifyContent: 'center' },
  selected: { backgroundColor: palette.primarySoft, borderColor: palette.primaryDeep }, optionText: { color: palette.secondary, fontSize: 13, fontWeight: '700' }, selectedText: { color: palette.primaryDeep },
  dates: { gap: 10 }, date: { gap: 5 }, error: { color: '#B42318', fontSize: 12 },
  segment: { flexDirection: 'row', borderWidth: 1, borderColor: palette.border, borderRadius: 12, padding: 3, gap: 3 },
  segmentOption: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 9 }, segmentSelected: { backgroundColor: palette.primarySoft },
  dueRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10 }, dueText: { color: palette.ink, fontSize: 14, fontWeight: '600' },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: palette.primaryDeep, alignItems: 'center', justifyContent: 'center' },
  checkSelected: { backgroundColor: palette.primaryDeep }, checkMark: { color: 'white', fontSize: 15, fontWeight: '800' },
  footer: { flexDirection: 'row', gap: 10, padding: 20, borderTopWidth: 1, borderTopColor: palette.border },
  reset: { minHeight: 48, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: palette.background }, resetText: { color: palette.primaryDeep, fontWeight: '700' },
  apply: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: palette.primaryDeep }, applyText: { color: 'white', fontWeight: '800' }, disabled: { opacity: .45 },
});
