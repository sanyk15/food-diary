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

interface SettingsRow {
  target_kcal: number;
  target_protein: number;
  target_fat: number;
  target_carbs: number;
  llm_model: string | null;
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

const SEED_ITEMS = (foodsJson as { items: SeedItem[] }).items;

/**
 * Заливает справочник в БД. Без force — только если таблица пуста.
 * С force — удаляет прежние seed-строки и заливает заново (правки
 * пользователя и ИИ-продукты не трогаются).
 */
export async function seedProducts(force = false): Promise<number> {
  if (!force) {
    const { count, error } = await supabase
      .from('food_products')
      .select('id', { count: 'exact', head: true });
    if (error) throw error;
    if ((count ?? 0) > 0) return 0;
  } else {
    const { error } = await supabase.from('food_products').delete().eq('source', 'seed');
    if (error) throw error;
  }

  // Пропускаем позиции, которые уже есть (например, добавлены вручную):
  // иначе уникальный индекс (user_id, lower(name)) завалит всю заливку.
  const { data: existing, error: existingError } = await supabase
    .from('food_products')
    .select('name');
  if (existingError) throw existingError;
  const taken = new Set(
    ((existing ?? []) as Array<{ name: string }>).map((row) => row.name.toLowerCase()),
  );

  const rows = SEED_ITEMS.filter((item) => !taken.has(item.name.toLowerCase())).map((item) => ({
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
  }));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await supabase.from('food_products').insert(chunk);
    if (error) throw error;
    inserted += chunk.length;
  }
  return inserted;
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
  const { data, error } = await supabase
    .from('food_settings')
    .select('target_kcal, target_protein, target_fat, target_carbs, llm_model')
    .maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_SETTINGS;
  const row = data as SettingsRow;
  return {
    targetKcal: row.target_kcal,
    targetProtein: row.target_protein,
    targetFat: row.target_fat,
    targetCarbs: row.target_carbs,
    llmModel: row.llm_model,
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error('Нет активной сессии.');

  const { error } = await supabase.from('food_settings').upsert({
    user_id: userId,
    target_kcal: settings.targetKcal,
    target_protein: settings.targetProtein,
    target_fat: settings.targetFat,
    target_carbs: settings.targetCarbs,
    llm_model: settings.llmModel,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
