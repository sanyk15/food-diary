// Поиск продукта в локальном справочнике по свободному описанию.
// Работает без сети и без модели: нормализация, отсечение служебных слов,
// грубый стемминг и сравнение токенов с допуском на опечатки/окончания.

import type { FoodProduct } from '../types';

export interface MatchCandidate {
  product: FoodProduct;
  score: number;
}

const STOP_WORDS = new Set([
  'и', 'с', 'со', 'в', 'во', 'на', 'из', 'по', 'для', 'без', 'или', 'а', 'же',
  'что', 'бы', 'чтобы', 'чтоб', 'порция', 'порцию', 'порции', 'немного', 'чуть',
  'грамм', 'грамма', 'граммов', 'гр', 'г', 'кг', 'мл', 'л', 'шт', 'штук',
  'взял', 'взяла', 'съел', 'съела', 'ел', 'ела', 'примерно', 'около', 'больше',
  'меньше', 'старался', 'старалась', 'тарелка', 'тарелку', 'ложка', 'ложки',
]);

const ENDINGS = [
  'ами', 'ями', 'ов', 'ев', 'ей', 'ой', 'ый', 'ий', 'ая', 'яя', 'ые', 'ие',
  'ом', 'ем', 'ах', 'ях', 'ам', 'ям', 'у', 'ю', 'а', 'я', 'ы', 'и', 'е', 'о',
];

export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stem(word: string): string {
  if (word.length <= 4) return word;
  for (const ending of ENDINGS) {
    if (word.endsWith(ending) && word.length - ending.length >= 3) {
      return word.slice(0, -ending.length);
    }
  }
  return word;
}

export function tokenize(value: string): string[] {
  return normalize(value)
    .split(' ')
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word))
    .map(stem)
    .filter((word) => word.length > 1);
}

/** Расстояние Левенштейна — для «курица» vs «куриная». */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && long.startsWith(short) && long.length - short.length <= 2) return true;
  const maxDistance = long.length >= 8 ? 2 : long.length >= 5 ? 1 : 0;
  return maxDistance > 0 && distance(a, b) <= maxDistance;
}

function tokenDice(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const used = new Set<number>();
  let intersection = 0;
  for (const left of a) {
    for (let i = 0; i < b.length; i += 1) {
      if (!used.has(i) && tokenMatch(left, b[i])) {
        used.add(i);
        intersection += 1;
        break;
      }
    }
  }
  return (2 * intersection) / (a.length + b.length);
}

function scoreOne(query: string, queryTokens: string[], target: string): number {
  const normalized = normalize(target);
  if (!normalized) return 0;
  if (normalized === query) return 1;

  const dice = tokenDice(queryTokens, tokenize(target));
  const contains =
    normalized.includes(query) || query.includes(normalized) ? 0.2 : 0;
  return Math.min(1, dice + contains);
}

/**
 * Возвращает кандидатов, отсортированных по убыванию похожести.
 * Порог 0.35 — ниже обычно начинается случайное совпадение.
 */
export function matchProduct(query: string, products: FoodProduct[]): MatchCandidate[] {
  const normalized = normalize(query);
  if (!normalized) return [];
  const queryTokens = tokenize(query);

  const candidates: MatchCandidate[] = [];
  for (const product of products) {
    let best = scoreOne(normalized, queryTokens, product.name);
    for (const alias of product.aliases) {
      const score = scoreOne(normalized, queryTokens, alias);
      if (score > best) best = score;
    }
    if (best >= 0.35) candidates.push({ product, score: best });
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 5);
}
