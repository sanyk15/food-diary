import { supabase } from './supabase';
import type {
  Basis,
  EntrySource,
  FoodEntry,
  FoodProduct,
  MealType,
  ProductSource,
  Settings,
} from '../types';
import { DEFAULT_SETTINGS } from '../types';
import foodsJson from '../data/foods.json';
import foodsExtraJson from '../data/foods-extra.json';
import foodsBrandsJson from '../data/foods-brands.json';

interface ProductRow {
  id: string;
  name: string;
  aliases: string[] | null;
  category: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  piece_grams: number | null;
  basis: Basis;
  source: ProductSource;
}

interface EntryRow {
  id: string;
  date: string;
  meal: MealType;
  name: string;
  grams: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  product_id: string | null;
  source: EntrySource;
  assumption: string | null;
}

function mapProduct(row: ProductRow): FoodProduct {
  return {
    id: row.id,
    name: row.name,
    aliases: row.aliases ?? [],
    category: row.category,
    kcal: Number(row.kcal),
    protein: Number(row.protein),
    fat: Number(row.fat),
    carbs: Number(row.carbs),
    pieceGrams: row.piece_grams === null ? null : Number(row.piece_grams),
    basis: row.basis,
    source: row.source,
  };
}

function mapEntry(row: EntryRow): FoodEntry {
  return {
    id: row.id,
    date: row.date,
    meal: row.meal,
    name: row.name,
    grams: Number(row.grams),
    kcal: Number(row.kcal),
    protein: Number(row.protein),
    fat: Number(row.fat),
    carbs: Number(row.carbs),
    productId: row.product_id,
    source: row.source,
    assumption: row.assumption,
  };
}

// ── Справочник ─────────────────────────────────────────────────

export async function fetchProducts(): Promise<FoodProduct[]> {
  const { data, error } = await supabase
    .from('food_products')
    .select('id, name, aliases, category, kcal, protein, fat, carbs, piece_grams, basis, source')
    .order('name');
  if (error) throw error;
  return (data as ProductRow[]).map(mapProduct);
}

export interface ProductInput {
  name: string;
  aliases: string[];
  category: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  pieceGrams: number | null;
  basis: Basis;
  source: ProductSource;
}

export async function addProduct(input: ProductInput): Promise<FoodProduct> {
  const { data, error } = await supabase
    .from('food_products')
    .insert({
      name: input.name,
      aliases: input.aliases,
      category: input.category,
      kcal: input.kcal,
      protein: input.protein,
      fat: input.fat,
      carbs: input.carbs,
      piece_grams: input.pieceGrams,
      basis: input.basis,
      source: input.source,
    })
    .select('id, name, aliases, category, kcal, protein, fat, carbs, piece_grams, basis, source')
    .single();
  if (error) throw error;
  return mapProduct(data as ProductRow);
}

export async function updateProduct(id: string, input: ProductInput): Promise<void> {
  const { error } = await supabase
    .from('food_products')
    .update({
      name: input.name,
      aliases: input.aliases,
      category: input.category,
      kcal: input.kcal,
      protein: input.protein,
      fat: input.fat,
      carbs: input.carbs,
      piece_grams: input.pieceGrams,
      basis: input.basis,
    })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteProduct(id: string): Promise<void> {
  const { error } = await supabase.from('food_products').delete().eq('id', id);
  if (error) throw error;
}

interface SeedItem {
  name: string;
  aliases?: string[];
  category?: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  pieceGrams?: number;
  basis?: Basis;
}

const RAW_SEED_ITEMS: SeedItem[] = [
  ...(foodsJson as { items: SeedItem[] }).items,
  ...(foodsExtraJson as { items: SeedItem[] }).items,
  ...(foodsBrandsJson as { items: SeedItem[] }).items,
];

// Дубликаты по имени (без учёта регистра) схлопываем: уникальный индекс
// (user_id, lower(name)) иначе завалит всю вставку.
const SEED_ITEMS: SeedItem[] = (() => {
  const seen = new Set<string>();
  return RAW_SEED_ITEMS.filter((item) => {
    const key = item.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
})();

interface ExistingProductRow {
  id: string;
  name: string;
  aliases: string[] | null;
  category: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  piece_grams: number | null;
  basis: Basis;
  source: ProductSource;
}

function sameAliases(left: string[] | null, right: string[]): boolean {
  const a = [...(left ?? [])].map((value) => value.toLowerCase()).sort();
  const b = [...right].map((value) => value.toLowerCase()).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function seedRow(item: SeedItem) {
  return {
    name: item.name,
    aliases: item.aliases ?? [],
    category: item.category ?? 'other',
    kcal: item.kcal,
    protein: item.protein,
    fat: item.fat,
    carbs: item.carbs,
    piece_grams: item.pieceGrams ?? null,
    basis: item.basis ?? 'ready',
    source: 'seed' as const,
  };
}

/**
 * Заливает справочник в БД. Без force — только если таблица пуста.
 *
 * С force не «удалить всё и вставить заново», а слить: неизменённые строки
 * остаются с теми же id, поэтому записи дневника сохраняют ссылку на продукт.
 * Удаляются только seed-строки, которых больше нет в наборе.
 */
export async function seedProducts(force = false): Promise<number> {
  const { data: existingData, error: existingError } = await supabase
    .from('food_products')
    .select('id, name, aliases, category, kcal, protein, fat, carbs, piece_grams, basis, source');
  if (existingError) throw existingError;

  const existing = (existingData ?? []) as ExistingProductRow[];
  if (!force && existing.length > 0) return 0;

  const byName = new Map(existing.map((row) => [row.name.toLowerCase(), row]));
  const seedNames = new Set(SEED_ITEMS.map((item) => item.name.toLowerCase()));

  const toInsert: Array<ReturnType<typeof seedRow>> = [];
  const toUpdate: Array<{ id: string; row: ReturnType<typeof seedRow> }> = [];

  for (const item of SEED_ITEMS) {
    const row = seedRow(item);
    const current = byName.get(item.name.toLowerCase());

    if (!current) {
      toInsert.push(row);
      continue;
    }
    // Ручной или ИИ-продукт с тем же именем не перезаписываем.
    if (current.source !== 'seed') continue;

    const changed =
      Number(current.kcal) !== row.kcal ||
      Number(current.protein) !== row.protein ||
      Number(current.fat) !== row.fat ||
      Number(current.carbs) !== row.carbs ||
      Number(current.piece_grams ?? -1) !== Number(row.piece_grams ?? -1) ||
      current.basis !== row.basis ||
      current.category !== row.category ||
      !sameAliases(current.aliases, row.aliases);

    if (changed) toUpdate.push({ id: current.id, row });
  }

  const toDelete = force
    ? existing
        .filter((row) => row.source === 'seed' && !seedNames.has(row.name.toLowerCase()))
        .map((row) => row.id)
    : [];

  for (let i = 0; i < toInsert.length; i += 100) {
    const chunk = toInsert.slice(i, i + 100);
    const { error } = await supabase.from('food_products').insert(chunk);
    if (error) throw error;
  }

  for (const { id, row } of toUpdate) {
    const { error } = await supabase
      .from('food_products')
      .update({
        aliases: row.aliases,
        category: row.category,
        kcal: row.kcal,
        protein: row.protein,
        fat: row.fat,
        carbs: row.carbs,
        piece_grams: row.piece_grams,
        basis: row.basis,
      })
      .eq('id', id);
    if (error) throw error;
  }

  for (let i = 0; i < toDelete.length; i += 100) {
    const chunk = toDelete.slice(i, i + 100);
    const { error } = await supabase.from('food_products').delete().in('id', chunk);
    if (error) throw error;
  }

  return toInsert.length + toUpdate.length;
}

// ── Дневник ────────────────────────────────────────────────────

export async function fetchEntries(from: string, to: string): Promise<FoodEntry[]> {
  const { data, error } = await supabase
    .from('food_entries')
    .select(
      'id, date, meal, name, grams, kcal, protein, fat, carbs, product_id, source, assumption',
    )
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as EntryRow[]).map(mapEntry);
}

export interface EntryInput {
  date: string;
  meal: MealType;
  name: string;
  grams: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  productId: string | null;
  source: EntrySource;
  assumption: string | null;
}

export async function addEntry(input: EntryInput): Promise<FoodEntry> {
  const { data, error } = await supabase
    .from('food_entries')
    .insert({
      date: input.date,
      meal: input.meal,
      name: input.name,
      grams: input.grams,
      kcal: input.kcal,
      protein: input.protein,
      fat: input.fat,
      carbs: input.carbs,
      product_id: input.productId,
      source: input.source,
      assumption: input.assumption,
    })
    .select(
      'id, date, meal, name, grams, kcal, protein, fat, carbs, product_id, source, assumption',
    )
    .single();
  if (error) throw error;
  return mapEntry(data as EntryRow);
}

export async function updateEntryGrams(id: string, grams: number, scaled: {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}): Promise<void> {
  const { error } = await supabase
    .from('food_entries')
    .update({ grams, ...scaled })
    .eq('id', id);
  if (error) throw error;
}

export async function updateEntryMeal(id: string, meal: MealType): Promise<void> {
  const { error } = await supabase.from('food_entries').update({ meal }).eq('id', id);
  if (error) throw error;
}

export async function deleteEntry(id: string): Promise<void> {
  const { error } = await supabase.from('food_entries').delete().eq('id', id);
  if (error) throw error;
}

// ── Настройки ──────────────────────────────────────────────────

export async function fetchSettings(): Promise<Settings> {
  // select('*'), а не список колонок: если миграция с advice_* ещё не
  // выполнена, приложение продолжит работать без синхронизации советов.
  const { data, error } = await supabase.from('food_settings').select('*').maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_SETTINGS;

  const row = data as {
    target_kcal: number;
    target_protein: number;
    target_fat: number;
    target_carbs: number;
    llm_model: string | null;
    advice_tips?: unknown;
    advice_updated_at?: unknown;
  };

  return {
    targetKcal: row.target_kcal,
    targetProtein: row.target_protein,
    targetFat: row.target_fat,
    targetCarbs: row.target_carbs,
    llmModel: row.llm_model,
    adviceTips: Array.isArray(row.advice_tips)
      ? row.advice_tips.filter((tip): tip is string => typeof tip === 'string')
      : null,
    adviceUpdatedAt: typeof row.advice_updated_at === 'string' ? row.advice_updated_at : null,
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error('Нет активной сессии.');

  const base = {
    user_id: userId,
    target_kcal: settings.targetKcal,
    target_protein: settings.targetProtein,
    target_fat: settings.targetFat,
    target_carbs: settings.targetCarbs,
    llm_model: settings.llmModel,
    updated_at: new Date().toISOString(),
  };

  let { error } = await supabase.from('food_settings').upsert({
    ...base,
    advice_tips: settings.adviceTips,
    advice_updated_at: settings.adviceUpdatedAt,
  });

  // Колонки советов появляются миграцией; без неё сохраняем остальные настройки.
  if (error && /advice_tips|advice_updated_at/i.test(error.message)) {
    ({ error } = await supabase.from('food_settings').upsert(base));
  }
  if (error) throw error;
}
