// Даты в локальном времени. Формат дня — 'YYYY-MM-DD'.
// Не использовать toISOString() для дат: сдвиг часового пояса.

const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey(): string {
  return toDateKey(new Date());
}

export function addDays(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return toDateKey(new Date(y, m - 1, d + delta));
}

/** '2026-11-16' → 'сегодня' | 'вчера' | '16 ноября, воскресенье' */
export function dayLabel(dateKey: string): string {
  const today = todayKey();
  if (dateKey === today) return 'сегодня';
  if (dateKey === addDays(today, -1)) return 'вчера';
  if (dateKey === addDays(today, 1)) return 'завтра';
  return dayTitle(dateKey);
}

/** '2026-11-16' → '16 ноября, воскресенье' */
export function dayTitle(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${d} ${MONTHS[m - 1]}${date.getFullYear() !== new Date().getFullYear() ? ` ${y}` : ''}, ${WEEKDAYS[date.getDay()]}`;
}

/** Короткая подпись для шапки: '16 ноября'. */
export function dayShort(dateKey: string): string {
  const [, m, d] = dateKey.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
