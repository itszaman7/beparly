/** Show the current three-digit format without rewriting issued document numbers. */
export function displayDocumentNumber(value: string) {
  const match = /^([PS])-0*(\d+)$/.exec(value);
  if (!match) return value;
  const digits = match[2].replace(/^0+(?=\d)/, '');
  return `${match[1]}-${digits.padStart(3, '0')}`;
}
