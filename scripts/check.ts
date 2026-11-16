// Быстрая проверка логики разбора и поиска на реальном примере.
// Запуск: npx esbuild scripts/check.ts --bundle --format=esm --platform=node --outfile=/tmp/check.mjs && node /tmp/check.mjs

import { parseMealText } from '../src/lib/parse';
import { matchProduct } from '../src/lib/match';
import { scaleProduct } from '../src/lib/nutrition';
import type { FoodProduct } from '../src/types';
import foods from '../src/data/foods.json';
import foodsExtra from '../src/data/foods-extra.json';
import foodsBrands from '../src/data/foods-brands.json';

interface SeedItem {
  name: string;
  aliases?: string[];
  category?: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  pieceGrams?: number;
  basis?: 'ready' | 'dry' | 'raw';
}

const seedItems = [
  ...(foods as { items: SeedItem[] }).items,
  ...(foodsExtra as { items: SeedItem[] }).items,
  ...(foodsBrands as { items: SeedItem[] }).items,
];

const products: FoodProduct[] = seedItems.map((item, index) => ({
  id: String(index),
  name: item.name,
  aliases: item.aliases ?? [],
  category: item.category ?? 'other',
  kcal: item.kcal,
  protein: item.protein,
  fat: item.fat,
  carbs: item.carbs,
  pieceGrams: item.pieceGrams ?? null,
  basis: item.basis ?? 'ready',
  source: 'seed',
}));

const text = `Ужин
90г макароны со сливками и беконом и сыром, взял порцию поменьше что бы не перебрать жиров
150г сувид курица грудка
1 мандарин`;

const parsed = parseMealText(text, 'other');
console.log('Позиций:', parsed.length);
for (const item of parsed) {
  const candidates = matchProduct(item.name, products);
  const best = candidates[0];
  console.log('─'.repeat(60));
  console.log('name:', item.name);
  console.log('meal:', item.meal, '| grams:', item.grams, '| count:', item.count, '| note:', item.note);
  if (best) {
    console.log('match:', best.product.name, '| score:', best.score.toFixed(3));
    console.log('top3:', candidates.slice(0, 3).map((c) => `${c.product.name} (${c.score.toFixed(2)})`).join(' | '));
    let grams = item.grams;
    if (grams === null && best.product.pieceGrams && item.count) {
      grams = Math.round(best.product.pieceGrams * item.count);
    }
    if (grams === null) grams = 100;
    console.log('КБЖУ за', grams, 'г:', scaleProduct(best.product, grams));
  } else {
    console.log('match: НЕ НАЙДЕНО');
  }
}

console.log('\nВсего в справочнике:', products.length);

const cases = [
  '2 яйца',
  '1 стакан кефира',
  '0,5 кг творога',
  '200 мл молока',
  'Завтрак: овсянка на молоке 200г',
  'Перекус 30г миндаль',
  '1 ст. л. сметаны',
  'Обед борщ 300г и хлеб 50г',
  'Простоквашино творог 5% 150г',
  'Сникерс 1 шт',
  'KFC острые крылья 200г',
  'Кола 0,5 л',
];

console.log('\n=== Дополнительные случаи ===');
for (const line of cases) {
  const items = parseMealText(line, 'other');
  console.log('\n>', line);
  for (const item of items) {
    const best = matchProduct(item.name, products)[0];
    console.log(
      `  name="${item.name}" meal=${item.meal} grams=${item.grams} count=${item.count}` +
        (best ? ` → ${best.product.name} (${best.score.toFixed(2)})` : ' → не найдено'),
    );
  }
}

// ── Советы ────────────────────────────────────────────────────
import { buildAdvice } from '../src/lib/advice';
import { addDays, todayKey } from '../src/lib/dates';
import type { FoodEntry, Settings } from '../src/types';

const byName = (name: string) => products.find((product) => product.name === name)!;
const bread = byName('хлеб белый');
const chicken = byName('куриная грудка отварная');
const sweet = byName('шоколад молочный');

const settings: Settings = {
  targetKcal: 2200,
  targetProtein: 140,
  targetFat: 70,
  targetCarbs: 250,
  llmModel: null,
};

const today = todayKey();
const fake: FoodEntry[] = [];
for (let i = 0; i < 7; i += 1) {
  const date = addDays(today, -i);
  const add = (product: typeof bread, grams: number, meal: FoodEntry['meal']) => {
    const k = grams / 100;
    fake.push({
      id: `${date}-${product.id}-${meal}`,
      date,
      meal,
      name: product.name,
      grams,
      kcal: Math.round(product.kcal * k),
      protein: Math.round(product.protein * k * 10) / 10,
      fat: Math.round(product.fat * k * 10) / 10,
      carbs: Math.round(product.carbs * k * 10) / 10,
      productId: product.id,
      source: 'product',
      assumption: null,
    });
  };
  add(bread, 100, 'breakfast');
  add(chicken, 150, 'lunch');
  if (i % 2 === 0) add(sweet, 100, 'snack');
}

console.log('\n=== Советы (7 дней: хлеб ежедневно, мало белка) ===');
for (const item of buildAdvice({ entries: fake, products, settings, today, days: 7 })) {
  console.log(`[${item.tone}] ${item.title} — ${item.text}`);
}

console.log('\n=== Советы без записей ===');
for (const item of buildAdvice({ entries: [], products, settings, today, days: 7 })) {
  console.log(`[${item.tone}] ${item.title} — ${item.text}`);
}
