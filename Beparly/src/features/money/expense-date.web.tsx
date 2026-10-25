import { palette } from '@/constants/design-system';

export function ExpenseDate({ value, onChange, maximum }: { value: string; onChange: (value: string) => void; maximum: string }) {
  return <label style={{ display: 'flex' }}>
    <input aria-label="Expense date" type="date" value={value} max={maximum} onChange={(event) => onChange(event.currentTarget.value)}
      style={{ height: 54, border: `1px solid ${palette.border}`, borderRadius: 14, padding: '0 16px', fontSize: 15, background: palette.surface, color: palette.ink }} />
  </label>;
}
