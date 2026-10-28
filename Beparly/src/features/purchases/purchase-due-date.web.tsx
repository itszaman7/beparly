type Props = { value: string; minimum: string; onChange: (value: string) => void };

export function PurchaseDueDate({ value, minimum, onChange }: Props) {
  return <input type="date" aria-label="Supplier due date" value={value} min={minimum}
    onChange={event => { if (event.target.value >= minimum) onChange(event.target.value); }}
    style={{ width: '100%', minHeight: 46, boxSizing: 'border-box', border: '1px solid #DCE6DF',
      backgroundColor: '#fff', borderRadius: 10, padding: '9px 12px', color: '#142A23', fontSize: 15 }} />;
}
