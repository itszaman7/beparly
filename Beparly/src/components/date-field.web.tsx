import { palette } from '@/constants/design-system';

type Props = { label: string; value: string; onChange: (value: string) => void };

export function DateField({ label, value, onChange }: Props) {
  return <input type="date" aria-label={label} value={value}
    onChange={(event) => onChange(event.currentTarget.value)}
    style={{ width: '100%', minHeight: 52, boxSizing: 'border-box', border: `1px solid ${palette.border}`,
      borderRadius: 12, backgroundColor: palette.surface, padding: '0 14px', color: palette.ink, fontSize: 15 }} />;
}
