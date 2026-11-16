// Разбор свободного описания еды на позиции.
//
// Пример входа:
//   Ужин
//   90г макароны со сливками и беконом и сыром, взял порцию поменьше
//   150г сувид курица грудка
//   1 мандарин
//
// Правила намеренно простые и предсказуемые: строки-заголовки задают приём
// пищи, граммы вытаскиваются регуляркой, остаток строки — название.

import type { MealType } from '../types';

export interface ParsedItem {
  raw: string;
  name: string;
  /** Вес в граммах, если указан явно (или через стакан/ложку). */
  grams: number | null;
  /** Количество штук, если указано («2 яйца»). */
  count: number | null;
  /** Комментарий после запятой («взял порцию поменьше»). */
  note: string | null;
  meal: MealType;
}

// Внимание: \b в JS опирается на \w (латиница/цифры), поэтому после кириллицы
// он не срабатывает. Вместо него — явный lookahead (?![а-яa-z]).
const MEAL_PATTERNS: Array<{ re: RegExp; meal: MealType }> = [
  { re: /^завтрак(?![а-яё])/i, meal: 'breakfast' },
  { re: /^обед(?![а-яё])/i, meal: 'lunch' },
  { re: /^ужин(?![а-яё])/i, meal: 'dinner' },
  { re: /^перекус(?![а-яё])/i, meal: 'snack' },
  { re: /^сно[кч](?![а-яё])/i, meal: 'snack' },
];

// «90г», «150 г», «0,5 кг», «200 мл», «1 л»
const GRAMS_RE = /(\d+(?:[.,]\d+)?)\s*(грамм(?:ов|а)?|кг|гр|г|мл|л)(?![а-яa-z])/i;
const GRAMS_GLOBAL = /(\d+(?:[.,]\d+)?)\s*(грамм(?:ов|а)?|кг|гр|г|мл|л)(?![а-яa-z])/gi;

// «1 шт», «2 куска», «стакан», «ст. л.», «ч. л.»
const COUNT_RE =
  /^(\d+(?:[.,]\d+)?)\s*(шт|штуки|штук|штука|кусок|куска|кусков|ломтик|ломтика|ломтиков|стакан|стакана|ложка|ложки|ст\.\s*л|ч\.\s*л)(?![а-яa-z])/i;

// «1 мандарин», «2 яйца» — число без единицы
const BARE_COUNT_RE = /^(\d+(?:[.,]\d+)?)\s+(?=[а-яa-z])/i;

// После запятой — комментарий, а не ещё один продукт.
const NOTE_RE =
  /^(взял|взяла|съел|съела|ел|ела|порци|немного|чуть|примерно|около|чтобы|чтоб|что бы|старал|больше|меньше|без |не )/i;

const VOLUME_GRAMS: Record<string, number> = {
  стакан: 250,
  стакана: 250,
  ложка: 15,
  ложки: 15,
  стл: 15,
  чл: 5,
};

function parseNumber(value: string): number {
  return Number.parseFloat(value.replace(',', '.'));
}

function splitNote(text: string): { main: string; note: string | null } {
  const comma = text.indexOf(',');
  if (comma === -1) return { main: text, note: null };
  const tail = text.slice(comma + 1).trim();
  if (tail && NOTE_RE.test(tail)) {
    return { main: text.slice(0, comma).trim(), note: tail };
  }
  return { main: text, note: null };
}

function cleanName(value: string): string {
  return value
    .replace(/^[\s,;:.\-–—]+/, '')
    .replace(/^(и|плюс|также|ещё|еще)\s+/i, '')
    .replace(/[\s,;:.\-–—]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Одна строка может содержать несколько позиций: «борщ 300г и хлеб 50г»,
 * «1 мандарин и 2 яйца». Делим по союзу перед числом, по «;»/«+» и по
 * повторному указанию граммов. Обычное «макароны с беконом и сыром» не делится:
 * после «и» нет числа.
 */
function splitSegments(line: string): string[] {
  const byConjunction = line.split(/\s+и\s+(?=\d)|\s*[;+]\s*/i).filter(Boolean);
  const result: string[] = [];

  for (const part of byConjunction) {
    const matches = [...part.matchAll(GRAMS_GLOBAL)];
    if (matches.length < 2) {
      result.push(part);
      continue;
    }

    let cursor = 0;
    for (const match of matches) {
      const end = (match.index ?? 0) + match[0].length;
      const segment = part.slice(cursor, end);
      if (segment.trim()) result.push(segment);
      cursor = end;
    }
    if (cursor < part.length) result.push(part.slice(cursor));
  }

  return result.map((part) => part.trim()).filter(Boolean);
}

function parseLine(line: string, meal: MealType): ParsedItem | null {
  const { main, note } = splitNote(line);
  let work = main;
  let grams: number | null = null;
  let count: number | null = null;

  const gramsMatch = work.match(GRAMS_RE);
  if (gramsMatch) {
    const value = parseNumber(gramsMatch[1]);
    const unit = gramsMatch[2].toLowerCase();
    const multiplier = unit === 'кг' || unit === 'л' ? 1000 : 1;
    grams = Math.round(value * multiplier);
    work = work.replace(gramsMatch[0], ' ');
  }

  const countMatch = work.match(COUNT_RE);
  if (countMatch) {
    const value = parseNumber(countMatch[1]);
    const unit = countMatch[2].toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
    const volume = VOLUME_GRAMS[unit];
    if (volume !== undefined) {
      grams = Math.round(value * volume);
    } else {
      count = value;
    }
    work = work.replace(countMatch[0], ' ');
  } else if (grams === null) {
    const bareMatch = work.match(BARE_COUNT_RE);
    if (bareMatch) {
      count = parseNumber(bareMatch[1]);
      work = work.replace(bareMatch[0], ' ');
    }
  }

  const name = cleanName(work) || cleanName(main);
  if (!name) return null;

  return { raw: line, name, grams, count, note, meal };
}

export function parseMealText(text: string, fallbackMeal: MealType = 'other'): ParsedItem[] {
  const items: ParsedItem[] = [];
  let meal: MealType = fallbackMeal;

  for (const rawLine of text.split(/\n+/)) {
    let line = rawLine.trim();
    if (!line) continue;

    const mealHit = MEAL_PATTERNS.find((pattern) => pattern.re.test(line));
    if (mealHit) {
      meal = mealHit.meal;
      line = line.replace(mealHit.re, '').replace(/^[\s:—–-]+/, '').trim();
      if (!line) continue;
    }

    for (const segment of splitSegments(line)) {
      const item = parseLine(segment, meal);
      if (item) items.push(item);
    }
  }
  return items;
}
