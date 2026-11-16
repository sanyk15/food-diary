import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { FoodEntry, FoodProduct, Settings } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import * as api from '../lib/api';
import type { EntryInput, ProductInput } from '../lib/api';
import { cacheGet, cacheSet } from '../lib/cache';
import { addDays, todayKey } from '../lib/dates';
import { round1 } from '../lib/nutrition';

const HISTORY_DAYS = 180;

interface DataContextValue {
  products: FoodProduct[];
  entries: FoodEntry[];
  settings: Settings;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addEntries: (inputs: EntryInput[]) => Promise<void>;
  removeEntry: (id: string) => Promise<void>;
  changeEntryGrams: (entry: FoodEntry, grams: number) => Promise<void>;
  changeEntryMeal: (entry: FoodEntry, meal: FoodEntry['meal']) => Promise<void>;
  createProduct: (input: ProductInput) => Promise<FoodProduct>;
  editProduct: (id: string, input: ProductInput) => Promise<void>;
  removeProduct: (id: string) => Promise<void>;
  reseed: () => Promise<number>;
  updateSettings: (next: Settings) => Promise<void>;
}

const DataContext = createContext<DataContextValue | undefined>(undefined);

export function DataProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<FoodProduct[]>(
    () => cacheGet<FoodProduct[]>('products') ?? [],
  );
  const [entries, setEntries] = useState<FoodEntry[]>(
    () => cacheGet<FoodEntry[]>('entries') ?? [],
  );
  const [settings, setSettings] = useState<Settings>(
    () => cacheGet<Settings>('settings') ?? DEFAULT_SETTINGS,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const to = todayKey();
      const from = addDays(to, -HISTORY_DAYS);

      let loadedProducts = await api.fetchProducts();
      // Первый вход: справочник пуст — заливаем базовую таблицу.
      if (loadedProducts.length === 0) {
        const seeded = await api.seedProducts();
        if (seeded > 0) loadedProducts = await api.fetchProducts();
      }

      const [loadedEntries, loadedSettings] = await Promise.all([
        api.fetchEntries(from, to),
        api.fetchSettings(),
      ]);

      setProducts(loadedProducts);
      setEntries(loadedEntries);
      setSettings(loadedSettings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить данные.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Кеш пишется после каждого изменения — следующий запуск откроется мгновенно.
  useEffect(() => {
    if (!loading) cacheSet('products', products);
  }, [products, loading]);

  useEffect(() => {
    if (!loading) cacheSet('entries', entries);
  }, [entries, loading]);

  useEffect(() => {
    if (!loading) cacheSet('settings', settings);
  }, [settings, loading]);

  const addEntries = useCallback(async (inputs: EntryInput[]) => {
    if (inputs.length === 0) return;
    const stamp = Date.now();
    const optimistic: FoodEntry[] = inputs.map((input, index) => ({
      id: `tmp-${stamp}-${index}`,
      ...input,
    }));

    setEntries((prev) => [...optimistic, ...prev]);
    try {
      const saved: FoodEntry[] = [];
      for (const input of inputs) {
        saved.push(await api.addEntry(input));
      }
      setEntries((prev) => {
        const tempIds = new Set(optimistic.map((item) => item.id));
        return [...saved, ...prev.filter((item) => !tempIds.has(item.id))];
      });
    } catch (err) {
      setEntries((prev) => prev.filter((item) => !optimistic.some((o) => o.id === item.id)));
      throw err;
    }
  }, []);

  const removeEntry = useCallback(async (id: string) => {
    const snapshot = entries;
    setEntries((prev) => prev.filter((item) => item.id !== id));
    try {
      await api.deleteEntry(id);
    } catch (err) {
      setEntries(snapshot);
      throw err;
    }
  }, [entries]);

  const changeEntryGrams = useCallback(async (entry: FoodEntry, grams: number) => {
    if (grams <= 0) return;
    const ratio = grams / entry.grams;
    const scaled = {
      kcal: round1(entry.kcal * ratio),
      protein: round1(entry.protein * ratio),
      fat: round1(entry.fat * ratio),
      carbs: round1(entry.carbs * ratio),
    };

    setEntries((prev) =>
      prev.map((item) => (item.id === entry.id ? { ...item, grams, ...scaled } : item)),
    );
    try {
      await api.updateEntryGrams(entry.id, grams, scaled);
    } catch (err) {
      setEntries((prev) =>
        prev.map((item) =>
          item.id === entry.id
            ? {
                ...item,
                grams: entry.grams,
                kcal: entry.kcal,
                protein: entry.protein,
                fat: entry.fat,
                carbs: entry.carbs,
              }
            : item,
        ),
      );
      throw err;
    }
  }, []);

  const changeEntryMeal = useCallback(async (entry: FoodEntry, meal: FoodEntry['meal']) => {
    if (entry.meal === meal) return;
    setEntries((prev) =>
      prev.map((item) => (item.id === entry.id ? { ...item, meal } : item)),
    );
    try {
      await api.updateEntryMeal(entry.id, meal);
    } catch (err) {
      setEntries((prev) =>
        prev.map((item) => (item.id === entry.id ? { ...item, meal: entry.meal } : item)),
      );
      throw err;
    }
  }, []);

  const createProduct = useCallback(async (input: ProductInput) => {
    const product = await api.addProduct(input);
    setProducts((prev) => [...prev, product]);
    return product;
  }, []);

  const editProduct = useCallback(async (id: string, input: ProductInput) => {
    await api.updateProduct(id, input);
    setProducts((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              name: input.name,
              aliases: input.aliases,
              category: input.category,
              kcal: input.kcal,
              protein: input.protein,
              fat: input.fat,
              carbs: input.carbs,
              pieceGrams: input.pieceGrams,
              basis: input.basis,
            }
          : item,
      ),
    );
  }, []);

  const removeProduct = useCallback(async (id: string) => {
    const snapshot = products;
    setProducts((prev) => prev.filter((item) => item.id !== id));
    try {
      await api.deleteProduct(id);
    } catch (err) {
      setProducts(snapshot);
      throw err;
    }
  }, [products]);

  const reseed = useCallback(async () => {
    const count = await api.seedProducts(true);
    const loaded = await api.fetchProducts();
    setProducts(loaded);
    return count;
  }, []);

  const updateSettings = useCallback(async (next: Settings) => {
    const snapshot = settings;
    setSettings(next);
    try {
      await api.saveSettings(next);
    } catch (err) {
      setSettings(snapshot);
      throw err;
    }
  }, [settings]);

  const value: DataContextValue = {
    products,
    entries,
    settings,
    loading,
    error,
    refresh,
    addEntries,
    removeEntry,
    changeEntryGrams,
    changeEntryMeal,
    createProduct,
    editProduct,
    removeProduct,
    reseed,
    updateSettings,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
