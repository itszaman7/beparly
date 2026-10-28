import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { AppSymbol } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { palette } from '@/constants/design-system';

type Props = { label: string; value: string; onChange: (value: string) => void };

export function DateField({ label, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date();

  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value || 'Choose date'}`}
      onPress={() => setOpen(true)} style={styles.input}>
      <Text numberOfLines={1} style={[styles.dateText, value ? styles.value : styles.placeholder]}>
        {value ? selected.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : 'Choose date'}
      </Text>
      <AppSymbol name="month" size={20} color={palette.primaryDeep} />
    </Pressable>
    {open && <DateTimePicker value={selected} mode="date" onChange={(event, date) => {
      setOpen(false);
      if (event.type === 'set' && date) {
        onChange(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
      }
    }} />}
  </>;
}

const styles = StyleSheet.create({
  input: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, borderRadius: 12,
    paddingHorizontal: 14 },
  dateText: { flex: 1 },
  value: { color: palette.ink, fontSize: 15 },
  placeholder: { color: palette.muted, fontSize: 15 },
});
