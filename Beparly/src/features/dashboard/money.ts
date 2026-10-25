/** Sum signed two-decimal amounts without floating-point arithmetic. */
export function sumMoney(values: string[]): string {
  let cents = 0n;
  for (const value of values) {
    const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
    if (!match) throw new Error('Invalid money amount.');
    const amount = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
    cents += match[1] === '-' ? -amount : amount;
  }
  const sign = cents < 0n ? '-' : '';
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
