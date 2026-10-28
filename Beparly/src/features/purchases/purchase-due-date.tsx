import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { AppText as Text } from '@/components/app-text';

type Props = { value: string; minimum: string; onChange: (value: string) => void };

export function PurchaseDueDate({ value, minimum, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const selected = value >= minimum ? value : minimum;
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`Supplier due date: ${value || 'Choose date'}`}
      onPress={() => setOpen(true)} style={styles.input}>
      <Text style={value ? styles.value : styles.placeholder}>
        {value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : 'Choose due date'}
      </Text>
    </Pressable>
    {open && <DateTimePicker value={new Date(`${selected}T12:00:00`)} mode="date"
      minimumDate={new Date(`${minimum}T00:00:00`)}
      onChange={(event, date) => {
        setOpen(false);
        if (event.type === 'set' && date) {
          const chosen = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          if (chosen >= minimum) onChange(chosen);
        }
      }} />}
  </>;
}

const styles = StyleSheet.create({
  input: { minHeight: 46, borderWidth: 1, borderColor: '#DCE6DF', backgroundColor: '#fff', borderRadius: 10,
    paddingHorizontal: 12, justifyContent: 'center' },
  value: { color: '#142A23', fontSize: 15 },
  placeholder: { color: '#66786F', fontSize: 15 },
});
