const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const dayFmt = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
const dateTimeFmt = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

export const formatCOP = (value) => money.format(value);

export function formatDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return dayFmt.format(new Date(y, m - 1, d));
}

export const formatTime = (ms) => timeFmt.format(new Date(ms));
export const formatDateTime = (ms) => dateTimeFmt.format(new Date(ms));
