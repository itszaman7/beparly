import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Pressable } from 'react-native';
import { Text } from 'tamagui';

import { palette } from '@/constants/design-system';

export function ExpenseDate({ value, onChange, maximum }: { value: string; onChange: (value: string) => void; maximum: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`Expense date: ${value}`} onPress={() => setOpen(true)}
      style={{ minHeight: 54, borderWidth: 1, borderColor: palette.border, borderRadius: 14, paddingHorizontal: 16, justifyContent: 'center', backgroundColor: palette.surface }}>
      <Text color={palette.ink} fontSize={15}>{new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
    </Pressable>
    {open && <DateTimePicker value={new Date(`${value}T12:00:00`)} mode="date" maximumDate={new Date(`${maximum}T23:59:59`)}
      onChange={(event, selected) => {
        setOpen(false);
        if (event.type === 'set' && selected) {
          const year = selected.getFullYear();
          const month = String(selected.getMonth() + 1).padStart(2, '0');
          const day = String(selected.getDate()).padStart(2, '0');
          onChange(`${year}-${month}-${day}`);
        }
      }} />}
  </>;
}
