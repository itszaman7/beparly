function scaled(value, decimals) {
  if (!new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction || '0').padEnd(decimals, '0'));
}

export function lineAmountCents(quantity, unitCost) {
  const q = scaled(quantity, 3);
  const cost = scaled(unitCost, 4);
  if (q === null || cost === null || q <= 0n || cost <= 0n) return null;
  const exact = q * cost;
  return exact % 100000n === 0n ? exact / 100000n : null;
}

export function purchaseAmountCents(lines) {
  let total = 0n;
  for (const line of lines) {
    const cents = lineAmountCents(line.quantity, line.unitCost);
    if (cents === null) return null;
    total += cents;
  }
  return total;
}
