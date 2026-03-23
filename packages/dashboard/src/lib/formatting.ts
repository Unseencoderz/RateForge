export function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDecimal(value: number, fractionDigits: number = 2): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatPercent(value: number): string {
  return `${formatDecimal(value * 100, 1)}%`;
}

export function formatLatency(value: number): string {
  return `${formatDecimal(value, value >= 100 ? 0 : 1)} ms`;
}

export function formatDateTime(timestamp: number | null): string {
  if (!timestamp) {
    return 'Waiting for a live snapshot';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(timestamp);
}
