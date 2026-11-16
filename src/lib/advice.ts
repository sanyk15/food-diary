// Подсказки по питанию. Основная часть считается локально по записям за
// последние дни — это бесплатно, мгновенно и предсказуемо. ИИ (см. llm.ts)
// используется только чтобы сформулировать персональный разбор.

import type { FoodEntry, FoodProduct, Settings } from '../types';
import { CATEGORY_LABELS } from '../types';
import { addDays } from './dates';

export type AdviceTone = 'good' | 'info' | 'warn';

export interface Advice {
  id: string;
  tone: AdviceTone;
  title: string;
  text: string;
}

export interface AdviceInput {
  entries: FoodEntry[];
  products: FoodProduct[];
  settings: Settings;
  today: string;
  days?: number;
}

const CATEGORY_SWAPS: Record<string, string> = {
  bread: 'попробуй хлебцы, цельнозерновой хлеб или овощи',
  sweet: 'замени часть на фрукты, ягоды или небольшую порцию тёмного шоколада',
  fastfood: 'домашняя версия обычно легче — запечь вместо жарить',
  sauce: 'майонез легко заменить сметаной, йогуртом или горчицей',
  nut: 'орехи полезны, но калорийны — держи порцию 20–30 г',
  drink: 'сладкие напитки — быстрый способ добрать сахар; вода или чай без сахара',
  meat: 'часть красного мяса можно заменить курицей, рыбой или бобовыми',
};

const SHARE_CATEGORIES = ['bread', 'sweet', 'fastfood', 'sauce', 'nut', 'drink'];

// Замену по категории предлагаем только там, где она осмысленна для конкретного
// продукта. Для мяса/орехов совет «замени курицей» рядом с самой курицей звучит глупо.
const FREQUENT_SWAP_CATEGORIES = new Set(['bread', 'sweet', 'fastfood', 'sauce', 'drink']);

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

export function buildAdvice({
  entries,
  products,
  settings,
  today,
  days = 7,
}: AdviceInput): Advice[] {
  const from = addDays(today, -(days - 1));
  const window = entries.filter((entry) => entry.date >= from && entry.date <= today);
  const productById = new Map(products.map((product) => [product.id, product]));

  if (window.length === 0) {
    return [
      {
        id: 'empty',
        tone: 'info',
        title: 'Пока нечего анализировать',
        text: 'Заполни пару дней — и здесь появятся подсказки по рациону.',
      },
    ];
  }

  const advice: Advice[] = [];
  const dates = new Set(window.map((entry) => entry.date));
  const activeDays = dates.size;

  // ── Частые продукты: минимум 3 разных дня ────────────────────
  const daysByName = new Map<string, Set<string>>();
  const metaByName = new Map<string, { name: string; category?: string }>();
  for (const entry of window) {
    const key = entry.name.toLowerCase();
    if (!daysByName.has(key)) daysByName.set(key, new Set());
    daysByName.get(key)?.add(entry.date);
    if (!metaByName.has(key)) {
      const product = entry.productId ? productById.get(entry.productId) : undefined;
      metaByName.set(key, { name: entry.name, category: product?.category });
    }
  }

  const frequent = [...daysByName.entries()]
    .filter(([, daySet]) => daySet.size >= 3)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 2);

  for (const [key, daySet] of frequent) {
    const meta = metaByName.get(key);
    if (!meta) continue;
    const swap =
      meta.category && FREQUENT_SWAP_CATEGORIES.has(meta.category)
        ? CATEGORY_SWAPS[meta.category]
        : undefined;
    advice.push({
      id: `freq-${key}`,
      tone: 'info',
      title: `«${meta.name}» — ${daySet.size} из ${days} дней`,
      text: swap
        ? `Похоже на привычку. Если хочется разнообразия, ${swap}.`
        : 'Повторяется часто — возможно, стоит чередовать с другими вариантами.',
    });
  }

  // ── Доля категорий по калориям ───────────────────────────────
  const kcalByCategory = new Map<string, number>();
  let totalKcal = 0;
  for (const entry of window) {
    const product = entry.productId ? productById.get(entry.productId) : undefined;
    const category = product?.category ?? 'other';
    kcalByCategory.set(category, (kcalByCategory.get(category) ?? 0) + entry.kcal);
    totalKcal += entry.kcal;
  }

  if (totalKcal > 0) {
    for (const category of SHARE_CATEGORIES) {
      const share = (kcalByCategory.get(category) ?? 0) / totalKcal;
      if (share < 0.2) continue;
      const swap = CATEGORY_SWAPS[category];
      advice.push({
        id: `share-${category}`,
        tone: 'warn',
        title: `${CATEGORY_LABELS[category] ?? category}: ${Math.round(share * 100)}% калорий`,
        text: swap
          ? `Многовато за ${days} дней. ${capitalize(swap)}.`
          : `Многовато за ${days} дней — посмотри, что можно заменить.`,
      });
    }
  }

  // ── Белок и перебор калорий по дням ──────────────────────────
  const dailyProtein = new Map<string, number>();
  const dailyKcal = new Map<string, number>();
  for (const entry of window) {
    dailyProtein.set(entry.date, (dailyProtein.get(entry.date) ?? 0) + entry.protein);
    dailyKcal.set(entry.date, (dailyKcal.get(entry.date) ?? 0) + entry.kcal);
  }

  const avgProtein = sum(dailyProtein.values()) / activeDays;
  if (settings.targetProtein > 0 && avgProtein < settings.targetProtein * 0.7) {
    advice.push({
      id: 'protein',
      tone: 'warn',
      title: `Белка маловато: ~${Math.round(avgProtein)} г из ${settings.targetProtein}`,
      text: 'Добавь творог, яйца, курицу, рыбу или бобовые — они хорошо насыщают.',
    });
  }

  const overDays = [...dailyKcal.values()].filter(
    (kcal) => settings.targetKcal > 0 && kcal > settings.targetKcal * 1.1,
  ).length;
  if (overDays >= 2) {
    advice.push({
      id: 'over',
      tone: 'warn',
      title: `Перебор калорий в ${overDays} из ${activeDays} дней`,
      text: 'Посмотри, что даёт лишние калории: соусы, хлеб, сладкое или размер порций.',
    });
  }

  // ── Овощи и фрукты ───────────────────────────────────────────
  const vegFruitDays = new Set<string>();
  for (const entry of window) {
    const product = entry.productId ? productById.get(entry.productId) : undefined;
    if (
      product &&
      (product.category === 'vegetable' ||
        product.category === 'fruit' ||
        product.category === 'berry')
    ) {
      vegFruitDays.add(entry.date);
    }
  }
  if (vegFruitDays.size < Math.ceil(activeDays / 2)) {
    advice.push({
      id: 'veg',
      tone: 'info',
      title: `Овощи и фрукты в ${vegFruitDays.size} из ${activeDays} дней`,
      text: 'Пара горстей овощей к обеду и фрукт на перекус — и день выглядит сбалансированнее.',
    });
  }

  // ── Регулярность заполнения ──────────────────────────────────
  if (activeDays < days - 2) {
    advice.push({
      id: 'regular',
      tone: 'info',
      title: `Записей за ${activeDays} из ${days} дней`,
      text: 'Чем ровнее заполняешь, тем точнее картина: пропуски сильно искажают итоги.',
    });
  }

  if (advice.length === 0) {
    advice.push({
      id: 'ok',
      tone: 'good',
      title: 'Выглядит неплохо',
      text: 'Резких перекосов за период не видно. Продолжай в том же духе.',
    });
  }

  return advice;
}

/** Компактная сводка для передачи модели. */
export function buildSummary({ entries, products, settings, today, days = 7 }: AdviceInput): string {
  const from = addDays(today, -(days - 1));
  const window = entries.filter((entry) => entry.date >= from && entry.date <= today);
  const productById = new Map(products.map((product) => [product.id, product]));

  const byDate = new Map<string, FoodEntry[]>();
  for (const entry of window) {
    const list = byDate.get(entry.date) ?? [];
    list.push(entry);
    byDate.set(entry.date, list);
  }

  const lines: string[] = [];
  lines.push(`Период: ${from} — ${today}. Цели: ${settings.targetKcal} ккал, Б ${settings.targetProtein}, Ж ${settings.targetFat}, У ${settings.targetCarbs}.`);

  for (const [date, list] of [...byDate.entries()].sort()) {
    const kcal = Math.round(sum(list.map((entry) => entry.kcal)));
    const protein = Math.round(sum(list.map((entry) => entry.protein)));
    const fat = Math.round(sum(list.map((entry) => entry.fat)));
    const carbs = Math.round(sum(list.map((entry) => entry.carbs)));
    const names = list.map((entry) => {
      const product = entry.productId ? productById.get(entry.productId) : undefined;
      return `${entry.name} ${Math.round(entry.grams)}г${product ? ` (${CATEGORY_LABELS[product.category] ?? product.category})` : ''}`;
    });
    lines.push(`${date}: ${kcal} ккал, Б ${protein}, Ж ${fat}, У ${carbs}. Еда: ${names.join('; ')}.`);
  }

  return lines.join('\n');
}
