export function quantityMilli(value) {
  if (!/^\d+(\.\d{1,3})?$/.test(value)) throw new Error('Enter a quantity with at most three decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const result = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('Quantity is too large.');
  return result;
}

export function canDeduct(confirmedMilli, pendingDeductionsMilli, requestedMilli) {
  return Number.isSafeInteger(confirmedMilli) && Number.isSafeInteger(pendingDeductionsMilli) &&
    Number.isSafeInteger(requestedMilli) && requestedMilli > 0 &&
    confirmedMilli + pendingDeductionsMilli >= requestedMilli;
}
