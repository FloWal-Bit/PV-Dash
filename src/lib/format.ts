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

export function formatKw(value: number, fractionDigits = 1): string {
  return `${formatSwissNumber(value, fractionDigits)} kW`;
}

/** z. B. +1'234.5 oder -12.3 (ohne Einheit). */
export function formatSignedSwissNumber(value: number, fractionDigits = 1): string {
  if (value > 0) return `+${formatSwissNumber(value, fractionDigits)}`;
  if (value < 0) return formatSwissNumber(value, fractionDigits);
  return formatSwissNumber(0, fractionDigits);
}

export function formatSignedKwh(value: number, fractionDigits = 1): string {
  return `${formatSignedSwissNumber(value, fractionDigits)} kWh`;
}
