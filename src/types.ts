// Модели данных. В БД поля snake_case, здесь — camelCase (маппинг в lib/api.ts).
// user_id формируется на стороне Supabase (RLS), на клиенте его нет.

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';
export type Basis = 'ready' | 'dry' | 'raw';
export type ProductSource = 'seed' | 'llm' | 'manual';
export type EntrySource = 'product' | 'llm' | 'manual';

/** Продукт или блюдо справочника. Значения — на 100 г. */
export interface FoodProduct {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  /** Вес одной штуки в граммах — для «1 мандарин», «2 яйца». */
  pieceGrams: number | null;
  basis: Basis;
  source: ProductSource;
}

/** Запись дневника. КБЖУ — снимок на момент записи. */
export interface FoodEntry {
  id: string;
  date: string; // 'YYYY-MM-DD'
  meal: MealType;
  name: string;
  grams: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  productId: string | null;
  source: EntrySource;
  /** Допущение оценки (для ИИ): «порция ~250 г, сливки 20%». */
  assumption: string | null;
}

export interface Settings {
  targetKcal: number;
  targetProtein: number;
  targetFat: number;
  targetCarbs: number;
  llmModel: string | null;
  /** Последние советы от ИИ — синхронизируются между устройствами. */
  adviceTips: string[] | null;
  adviceUpdatedAt: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  targetKcal: 2200,
  targetProtein: 140,
  targetFat: 70,
  targetCarbs: 250,
  llmModel: null,
  adviceTips: null,
  adviceUpdatedAt: null,
};

export interface Totals {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export const EMPTY_TOTALS: Totals = { kcal: 0, protein: 0, fat: 0, carbs: 0 };

export const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  snack: 'Перекус',
  other: 'Другое',
};

export const BASIS_LABELS: Record<Basis, string> = {
  ready: 'готовый',
  dry: 'сухой вес',
  raw: 'сырой вес',
};

/** Цвета для приёмов пищи — по ним красится полоска в списке. */
export const MEAL_COLORS: Record<MealType, string> = {
  breakfast: '#f0a13a',
  lunch: '#2f9e6e',
  dinner: '#5b7fe0',
  snack: '#c26bd8',
  other: '#8c8a94',
};

export const CATEGORY_LABELS: Record<string, string> = {
  grain: 'Крупы и гарниры',
  pasta: 'Макароны и тесто',
  meat: 'Мясо и птица',
  fish: 'Рыба и морепродукты',
  dairy: 'Молочное',
  egg: 'Яйца',
  vegetable: 'Овощи',
  fruit: 'Фрукты',
  berry: 'Ягоды',
  nut: 'Орехи и семечки',
  bread: 'Хлеб и выпечка',
  dish: 'Готовые блюда',
  drink: 'Напитки',
  sweet: 'Сладкое',
  fastfood: 'Фастфуд',
  sauce: 'Соусы и масла',
  other: 'Другое',
};

export const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);
