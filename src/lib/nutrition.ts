import type { FoodEntry, FoodProduct, Totals } from '../types';

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** КБЖУ порции по значениям на 100 г. */
export function scaleProduct(
  product: Pick<FoodProduct, 'kcal' | 'protein' | 'fat' | 'carbs'>,
  grams: number,
): Totals {
  const k = grams / 100;
  return {
    kcal: round1(product.kcal * k),
    protein: round1(product.protein * k),
    fat: round1(product.fat * k),
    carbs: round1(product.carbs * k),
  };
}

export function sumTotals(items: Array<Pick<FoodEntry, 'kcal' | 'protein' | 'fat' | 'carbs'>>): Totals {
  return items.reduce<Totals>(
    (acc, item) => ({
      kcal: round1(acc.kcal + item.kcal),
      protein: round1(acc.protein + item.protein),
      fat: round1(acc.fat + item.fat),
      carbs: round1(acc.carbs + item.carbs),
    }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  );
}

/** Калорийность, вытекающая из макросов (4/9/4). */
export function kcalFromMacros(protein: number, fat: number, carbs: number): number {
  return round1(protein * 4 + fat * 9 + carbs * 4);
}

/**
 * Насколько КБЖУ согласованы между собой. Расхождение больше 30% —
 * признак ошибки модели (например, перепутаны порция и 100 г).
 */
export function macrosConsistent(kcal: number, protein: number, fat: number, carbs: number): boolean {
  const derived = kcalFromMacros(protein, fat, carbs);
  if (derived <= 0 && kcal <= 0) return true;
  const base = Math.max(kcal, derived, 1);
  return Math.abs(kcal - derived) / base <= 0.3;
}

/** Приводит КБЖУ к согласованному виду, если модель наврала в арифметике. */
export function normalizeMacros(kcal: number, protein: number, fat: number, carbs: number): Totals {
  const derived = kcalFromMacros(protein, fat, carbs);
  if (kcal <= 0 && derived > 0) {
    return { kcal: derived, protein: round1(protein), fat: round1(fat), carbs: round1(carbs) };
  }
  if (!macrosConsistent(kcal, protein, fat, carbs) && derived > 0) {
    // Макросы обычно надёжнее «придуманной» калорийности — берём их.
    return { kcal: derived, protein: round1(protein), fat: round1(fat), carbs: round1(carbs) };
  }
  return { kcal: round1(kcal), protein: round1(protein), fat: round1(fat), carbs: round1(carbs) };
}
