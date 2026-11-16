import { useState } from 'react';
import Modal from './Modal';
import { useData } from '../context/DataContext';
import { parseMealText } from '../lib/parse';
import type { ParsedItem } from '../lib/parse';
import { matchProduct } from '../lib/match';
import type { MatchCandidate } from '../lib/match';
import { round1 } from '../lib/nutrition';
import { estimateItems, loadLlmConfig } from '../lib/llm';
import type { LlmEstimate } from '../lib/llm';
import type { EntrySource, FoodProduct, MealType, Totals } from '../types';
import { BASIS_LABELS, MEAL_COLORS, MEAL_LABELS, MEAL_ORDER } from '../types';
import type { EntryInput } from '../lib/api';
import { haptic } from '../lib/haptics';

interface DraftItem {
  key: string;
  /** Как пользователь описал позицию. */
  title: string;
  meal: MealType;
  grams: number;
  /** КБЖУ на 100 г — из справочника, ИИ или ручного ввода. */
  per100: Totals;
  source: EntrySource;
  assumption: string | null;
  productId: string | null;
  productName: string | null;
  candidates: MatchCandidate[];
  manualOpen: boolean;
}

const ZERO: Totals = { kcal: 0, protein: 0, fat: 0, carbs: 0 };

function buildDraft(parsed: ParsedItem, products: FoodProduct[]): DraftItem {
  const candidates = matchProduct(parsed.name, products);
  const best = candidates[0];
  const product = best && best.score >= 0.55 ? best.product : null;

  let grams = parsed.grams;
  if (grams === null && product?.pieceGrams && parsed.count) {
    grams = Math.round(product.pieceGrams * parsed.count);
  }
  if (grams === null || grams <= 0) grams = 100;

  const per100 = product
    ? {
        kcal: product.kcal,
        protein: product.protein,
        fat: product.fat,
        carbs: product.carbs,
      }
    : ZERO;

  return {
    key: `${parsed.raw}-${Math.random().toString(36).slice(2, 8)}`,
    title: parsed.name,
    meal: parsed.meal,
    grams,
    per100,
    source: product ? 'product' : 'manual',
    assumption: parsed.note,
    productId: product?.id ?? null,
    productName: product?.name ?? null,
    candidates,
    manualOpen: false,
  };
}

function totalsOf(draft: DraftItem): Totals {
  const k = draft.grams / 100;
  return {
    kcal: round1(draft.per100.kcal * k),
    protein: round1(draft.per100.protein * k),
    fat: round1(draft.per100.fat * k),
    carbs: round1(draft.per100.carbs * k),
  };
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim();
}

interface Props {
  date: string;
  defaultMeal: MealType;
  onClose: () => void;
}

export default function EntrySheet({ date, defaultMeal, onClose }: Props) {
  const { products, addEntries } = useData();
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [parsed, setParsed] = useState(false);
  const [llmBusy, setLlmBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalKcal = drafts.reduce((sum, draft) => sum + totalsOf(draft).kcal, 0);

  function handleParse() {
    setError(null);
    const items = parseMealText(text, defaultMeal);
    if (items.length === 0) {
      setError('Не удалось разобрать ни одной позиции. Попробуй формат «150г куриная грудка».');
      return;
    }
    const nextDrafts = items.map((item) => buildDraft(item, products));
    setDrafts(nextDrafts);
    setParsed(true);
    haptic();

    // Сразу оцениваем только то, что не нашлось в справочнике, — если ИИ настроен.
    const config = loadLlmConfig();
    const unmatched = nextDrafts.filter((draft) => draft.productId === null);
    if (config.apiKey && config.model && unmatched.length > 0) {
      void runEstimate(unmatched);
    }
  }

  function updateDraft(key: string, patch: Partial<DraftItem>) {
    setDrafts((prev) => prev.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
  }

  function pickProduct(draft: DraftItem, candidate: MatchCandidate) {
    updateDraft(draft.key, {
      productId: candidate.product.id,
      productName: candidate.product.name,
      source: 'product',
      per100: {
        kcal: candidate.product.kcal,
        protein: candidate.product.protein,
        fat: candidate.product.fat,
        carbs: candidate.product.carbs,
      },
    });
    haptic();
  }

  async function runEstimate(target: DraftItem[]) {
    const missing = target.filter((draft) => draft.productId === null);
    if (missing.length === 0) return;

    const config = loadLlmConfig();
    if (!config.apiKey || !config.model) {
      setError('Сначала добавь ключ и модель OpenRouter в настройках.');
      return;
    }

    setError(null);
    setLlmBusy(true);
    try {
      const estimates = await estimateItems(
        missing.map((draft) => ({
          name: draft.title,
          grams: draft.grams,
          note: draft.assumption,
          meal: MEAL_LABELS[draft.meal],
        })),
        config,
      );

      // Модель не обязана сохранять порядок — сначала ищем по названию,
      // затем раздаём оставшиеся оценки по порядку.
      const mapping = new Map<string, LlmEstimate>();
      const used = new Set<number>();
      for (const draft of missing) {
        let index = estimates.findIndex(
          (estimate, i) =>
            !used.has(i) && normalizeName(estimate.name) === normalizeName(draft.title),
        );
        if (index === -1) index = estimates.findIndex((_, i) => !used.has(i));
        if (index === -1) continue;
        used.add(index);
        mapping.set(draft.key, estimates[index]);
      }

      setDrafts((prev) =>
        prev.map((draft) => {
          const estimate = mapping.get(draft.key);
          if (!estimate) return draft;
          const k = 100 / estimate.grams;
          return {
            ...draft,
            grams: estimate.grams,
            per100: {
              kcal: round1(estimate.kcal * k),
              protein: round1(estimate.protein * k),
              fat: round1(estimate.fat * k),
              carbs: round1(estimate.carbs * k),
            },
            source: 'llm',
            assumption: estimate.assumption || draft.assumption,
          };
        }),
      );
      haptic([10, 40, 10]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось оценить через ИИ.');
    } finally {
      setLlmBusy(false);
    }
  }

  async function handleSave() {
    const valid = drafts.filter((draft) => draft.grams > 0);
    if (valid.length === 0) return;

    setSaveBusy(true);
    setError(null);
    try {
      const inputs: EntryInput[] = valid.map((draft) => {
        const totals = totalsOf(draft);
        return {
          date,
          meal: draft.meal,
          name: draft.productName ?? draft.title,
          grams: draft.grams,
          kcal: totals.kcal,
          protein: totals.protein,
          fat: totals.fat,
          carbs: totals.carbs,
          productId: draft.productId,
          source: draft.source,
          assumption: draft.assumption,
        };
      });
      await addEntries(inputs);
      haptic([10, 30, 10]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить.');
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <Modal title="Что съел?" onClose={onClose}>
      <div className="sheet-body">
        <textarea
          className="meal-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Ужин\n90г макароны со сливками и беконом и сыром\n150г сувид курица грудка\n1 мандарин'}
          rows={5}
        />

        <div className="sheet-actions">
          <button className="btn btn-primary" onClick={handleParse} disabled={!text.trim()}>
            Разобрать
          </button>
          {parsed && (
            <button className="btn btn-ghost" onClick={() => setDrafts([])}>
              Сбросить
            </button>
          )}
        </div>

        {error && <div className="form-error">{error}</div>}

        {drafts.length > 0 && (
          <>
            <div className="draft-list">
              {drafts.map((draft) => {
                const totals = totalsOf(draft);
                const matchedProduct = draft.productId
                  ? products.find((product) => product.id === draft.productId)
                  : null;
                return (
                  <div className="draft" key={draft.key}>
                    <div className="draft-head">
                      <div className="draft-title">
                        <span className="meal-dot" style={{ background: MEAL_COLORS[draft.meal] }} />
                        {draft.title}
                      </div>
                      <button
                        className="icon-btn"
                        aria-label="Удалить позицию"
                        onClick={() =>
                          setDrafts((prev) => prev.filter((item) => item.key !== draft.key))
                        }
                      >
                        ✕
                      </button>
                    </div>

                    <div className="draft-row">
                      <label className="grams-field">
                        <input
                          type="number"
                          inputMode="decimal"
                          min={1}
                          value={draft.grams}
                          onChange={(e) =>
                            updateDraft(draft.key, {
                              grams: Math.max(1, Number(e.target.value) || 1),
                            })
                          }
                        />
                        <span>г</span>
                      </label>

                      <select
                        className="meal-select"
                        value={draft.meal}
                        aria-label="Приём пищи"
                        onChange={(e) =>
                          updateDraft(draft.key, { meal: e.target.value as MealType })
                        }
                      >
                        {MEAL_ORDER.map((meal) => (
                          <option key={meal} value={meal}>
                            {MEAL_LABELS[meal]}
                          </option>
                        ))}
                      </select>

                      <div className="draft-macros">
                        <b>{Math.round(totals.kcal)} ккал</b>
                        <span>
                          Б {totals.protein} · Ж {totals.fat} · У {totals.carbs}
                        </span>
                      </div>
                    </div>

                    <div className="draft-match">
                      {draft.productName ? (
                        <span className="match-ok">
                          ✓ {draft.productName}
                          {matchedProduct && matchedProduct.basis !== 'ready' && (
                            <span className="draft-note"> · {BASIS_LABELS[matchedProduct.basis]}</span>
                          )}
                          {matchedProduct &&
                            matchedProduct.basis === 'ready' &&
                            matchedProduct.category === 'dish' && (
                              <span className="draft-note"> · вес готового блюда</span>
                            )}
                        </span>
                      ) : draft.source === 'llm' ? (
                        <span className="match-llm">≈ оценка ИИ</span>
                      ) : (
                        <span className="match-missing">не найдено в справочнике</span>
                      )}
                      {draft.assumption && (
                        <span className="draft-note">{draft.assumption}</span>
                      )}
                    </div>

                    {draft.candidates.length > 0 && (
                      <div className="candidates">
                        {draft.candidates.slice(0, 3).map((candidate) => (
                          <button
                            key={candidate.product.id}
                            className={`chip ${draft.productId === candidate.product.id ? 'chip-active' : ''}`}
                            onClick={() => pickProduct(draft, candidate)}
                          >
                            {candidate.product.name}
                            <em>{Math.round(candidate.score * 100)}%</em>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="draft-tools">
                      {draft.productId === null && (
                        <button className="link-btn" onClick={() => void runEstimate([draft])} disabled={llmBusy}>
                          {llmBusy ? 'Оцениваю…' : 'Оценить через ИИ'}
                        </button>
                      )}
                      <button
                        className="link-btn"
                        onClick={() => updateDraft(draft.key, { manualOpen: !draft.manualOpen })}
                      >
                        {draft.manualOpen ? 'Скрыть КБЖУ' : 'КБЖУ вручную'}
                      </button>
                    </div>

                    {draft.manualOpen && (
                      <div className="manual-grid">
                        {(
                          [
                            ['kcal', 'ккал'],
                            ['protein', 'Б'],
                            ['fat', 'Ж'],
                            ['carbs', 'У'],
                          ] as const
                        ).map(([field, label]) => (
                          <label key={field}>
                            <span>{label}</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              value={draft.per100[field]}
                              onChange={(e) =>
                                updateDraft(draft.key, {
                                  source: draft.productId ? 'product' : 'manual',
                                  per100: {
                                    ...draft.per100,
                                    [field]: Math.max(0, Number(e.target.value) || 0),
                                  },
                                })
                              }
                            />
                          </label>
                        ))}
                        <div className="manual-hint">на 100 г</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="sheet-total">
              <span>Итого</span>
              <b>{Math.round(totalKcal)} ккал</b>
            </div>

            <button
              className="btn btn-primary btn-wide"
              onClick={() => void handleSave()}
              disabled={saveBusy || drafts.length === 0}
            >
              {saveBusy ? 'Сохраняю…' : `Добавить в день (${drafts.length})`}
            </button>
          </>
        )}

        {!parsed && (
          <p className="hint">
            Пиши как удобно: строки, граммы, штуки. Заголовки «Завтрак», «Обед», «Ужин»,
            «Перекус» задают приём пищи.
          </p>
        )}

      </div>
    </Modal>
  );
}
