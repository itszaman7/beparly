function validDecimal(value, places, optional = false) {
  const trimmed = value.trim();
  if (!trimmed) return optional;
  return new RegExp(`^\\d+(\\.\\d{1,${places}})?$`).test(trimmed);
}

function formatBdt(value) {
  if (value === null) return 'Not set';
  if (/^-?0(?:\.0+)?(?:E[+-]?\d+)?$/i.test(value)) return '৳0.00';
  const [whole, fractional = ''] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `৳${grouped}.${fractional.padEnd(2, '0').slice(0, 2)}`;
}

module.exports = { validDecimal, formatBdt };
