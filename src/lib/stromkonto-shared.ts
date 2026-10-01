/** Gemeinsame Konstanten/Helfer für Stromkonto (Client + Server). */

export const DEFAULT_STROMKONTO_BALANCE_KWH = 516;

export function parseStromkontoBalanceInput(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
