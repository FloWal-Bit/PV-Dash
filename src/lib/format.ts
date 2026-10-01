/** Swiss-style number: apostrophe thousands, period as decimal separator. */
export function formatSwissNumber(value: number, fractionDigits = 0): string {
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(fractionDigits);
  const [intPart, fracPart] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  const body = fractionDigits > 0 ? `${grouped}.${fracPart}` : grouped;
  return negative ? `-${body}` : body;
}

export function formatYieldKwh(value: number, fractionDigits: number): string {
  return `${formatSwissNumber(value, fractionDigits)} kWh`;
}
