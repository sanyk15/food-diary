// Оценка КБЖУ и советы через OpenRouter (бесплатные модели с суффиксом :free).
// Ключ хранится только в localStorage устройства и никогда не уходит в БД.

import { normalizeMacros } from './nutrition';

const BASE = 'https://openrouter.ai/api/v1';
const KEY_STORAGE = 'food_llm_key';
const MODEL_STORAGE = 'food_llm_model';

export interface LlmConfig {
  apiKey: string;
  model: string;
}

export interface LlmInput {
  name: string;
  grams: number | null;
  note?: string | null;
  meal?: string;
}

export interface LlmEstimate {
  name: string;
  grams: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  assumption: string;
}

export interface FreeModel {
  id: string;
  name: string;
}

// Роутер, который сам выбирает случайную бесплатную модель. Не заканчивается
// на :free, поэтому добавляем его отдельно.
const FREE_ROUTER = 'openrouter/free';

// Порядок для этой задачи: держат JSON, не тратят токены на размышления,
// нормально понимают русский. Остальные free-модели — ниже по алфавиту.
const PREFERRED = [
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'inclusionai/ling-3.2-flash:free',
  'thinkingmachines/inkling-2-small:free',
  'baidu/ernie-5.5-flash-preview:free',
];

export function loadLlmConfig(): LlmConfig {
  try {
    return {
      apiKey: localStorage.getItem(KEY_STORAGE) ?? '',
      model: localStorage.getItem(MODEL_STORAGE) ?? '',
    };
  } catch {
    return { apiKey: '', model: '' };
  }
}

export function saveLlmConfig(config: LlmConfig): void {
  try {
    localStorage.setItem(KEY_STORAGE, config.apiKey.trim());
    localStorage.setItem(MODEL_STORAGE, config.model.trim());
  } catch {
    // ignore
  }
}

/** Подхватывает модель, сохранённую в аккаунте, если на этом устройстве её ещё нет. */
export function adoptModelFromSettings(model: string | null): void {
  if (!model) return;
  try {
    if (!localStorage.getItem(MODEL_STORAGE)) localStorage.setItem(MODEL_STORAGE, model);
  } catch {
    // ignore
  }
}

export async function fetchFreeModels(): Promise<FreeModel[]> {
  const res = await fetch(`${BASE}/models`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Не удалось получить список моделей (${res.status}).`);
  const payload = (await res.json()) as { data?: Array<{ id: string; name?: string }> };

  const models = (payload.data ?? [])
    .filter((model) => model.id.endsWith(':free') || model.id === FREE_ROUTER)
    .map((model) => ({ id: model.id, name: model.name ?? model.id }));

  if (!models.some((model) => model.id === FREE_ROUTER)) {
    models.push({ id: FREE_ROUTER, name: 'Free Models Router (авто)' });
  }

  const rank = new Map(PREFERRED.map((id, index) => [id, index]));
  models.sort((a, b) => {
    const ra = rank.get(a.id) ?? PREFERRED.length;
    const rb = rank.get(b.id) ?? PREFERRED.length;
    return ra - rb || a.id.localeCompare(b.id);
  });

  if (models.length === 0) throw new Error('У OpenRouter сейчас нет бесплатных моделей.');
  return models;
}

function assertConfig(config: LlmConfig): void {
  if (!config.apiKey.trim()) {
    throw new Error('Не задан ключ OpenRouter. Добавь его в настройках.');
  }
  if (!config.model.trim()) {
    throw new Error('Не выбрана модель OpenRouter. Выбери её в настройках.');
  }
}

function extractJson(content: string): unknown {
  const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Модель вернула не JSON. Попробуй другую бесплатную модель.');
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error('Не удалось разобрать ответ модели. Попробуй другую бесплатную модель.');
  }
}

async function chat(
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  config: LlmConfig,
  maxTokens: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey.trim()}`,
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Food Diary',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        max_tokens: maxTokens,
        messages,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401) throw new Error('OpenRouter отклонил ключ. Проверь его в настройках.');
      if (res.status === 429) {
        throw new Error('Лимит бесплатной модели исчерпан. Попробуй позже или другую модель.');
      }
      throw new Error(
        `OpenRouter ответил ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
      );
    }

    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return payload.choices?.[0]?.message?.content ?? '';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Модель не ответила за минуту. Попробуй ещё раз или другую модель.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// ── Оценка КБЖУ ────────────────────────────────────────────────

const ESTIMATE_PROMPT = `Ты — нутрициолог. Оцени КБЖУ блюд по описанию.
Отвечай ТОЛЬКО валидным JSON без markdown и пояснений.

Для каждого пункта верни:
- name — краткое название блюда;
- grams — вес порции в граммах (число);
- kcal, protein, fat, carbs — числа на указанную порцию (не на 100 г);
- assumption — одна короткая фраза о допущении.

Правила:
- Если вес не указан — оцени типичную порцию и укажи это в assumption.
- «Макароны 90 г» без уточнения считай весом готового блюда.
- Учитывай жирность: сливки 20% или 33%, сметана, майонез.
- Не выдумывай экзотические ингредиенты, которых нет в описании.

Формат ответа:
{"items":[{"name":"...","grams":90,"kcal":200,"protein":9,"fat":11,"carbs":20,"assumption":"..."}]}`;

function num(value: unknown, fallback = 0): number {
  const parsed =
    typeof value === 'string' ? Number.parseFloat(value.replace(',', '.')) : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeEstimate(raw: unknown, index: number): LlmEstimate | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const name =
    typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : `Позиция ${index + 1}`;
  const grams = Math.round(num(obj.grams, 100)) || 100;
  const totals = normalizeMacros(num(obj.kcal), num(obj.protein), num(obj.fat), num(obj.carbs));

  return {
    name,
    grams,
    kcal: totals.kcal,
    protein: totals.protein,
    fat: totals.fat,
    carbs: totals.carbs,
    assumption: typeof obj.assumption === 'string' ? obj.assumption.trim() : '',
  };
}

function parseEstimates(content: string): LlmEstimate[] {
  const parsed = extractJson(content);
  const rawItems = Array.isArray(parsed) ? parsed : (parsed as { items?: unknown }).items;
  if (!Array.isArray(rawItems)) throw new Error('В ответе модели нет списка items.');

  const items = rawItems
    .map((raw, index) => normalizeEstimate(raw, index))
    .filter((item): item is LlmEstimate => item !== null);

  if (items.length === 0) throw new Error('Модель не вернула ни одной позиции.');
  return items;
}

export async function estimateItems(
  items: LlmInput[],
  config: LlmConfig,
): Promise<LlmEstimate[]> {
  assertConfig(config);
  const content = await chat(
    [
      { role: 'system', content: ESTIMATE_PROMPT },
      { role: 'user', content: `Оцени КБЖУ: ${JSON.stringify(items)}` },
    ],
    config,
    3000,
  );
  return parseEstimates(content);
}

// ── Советы по питанию ──────────────────────────────────────────

const ADVICE_PROMPT = `Ты — практичный нутрициолог. По сводке дневника питания дай ровно 3 коротких конкретных совета на русском.

Правила:
- Опирайся только на данные сводки, не выдумывай продукты, которых там нет.
- Каждый совет — 1–2 предложения, без воды и общих фраз.
- Учитывай цели пользователя по ккал и БЖУ.
- Если всё в порядке — так и скажи, но всё равно предложи 3 идеи для улучшения.

Отвечай ТОЛЬКО JSON: {"tips":["...","...","..."]}`;

export async function adviseNutrition(summary: string, config: LlmConfig): Promise<string[]> {
  assertConfig(config);
  const content = await chat(
    [
      { role: 'system', content: ADVICE_PROMPT },
      { role: 'user', content: summary },
    ],
    config,
    1200,
  );

  const parsed = extractJson(content);
  const rawTips = Array.isArray(parsed) ? parsed : (parsed as { tips?: unknown }).tips;
  if (!Array.isArray(rawTips)) throw new Error('В ответе модели нет списка советов.');

  const tips = rawTips
    .filter((tip): tip is string => typeof tip === 'string' && tip.trim().length > 0)
    .map((tip) => tip.trim())
    .slice(0, 3);

  if (tips.length === 0) throw new Error('Модель не вернула советов.');
  return tips;
}
