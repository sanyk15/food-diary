import { useMemo, useState } from 'react';
import NavBar from '../components/NavBar';
import EntrySheet from '../components/EntrySheet';
import Modal from '../components/Modal';
import { useData } from '../context/DataContext';
import { addDays, dayLabel, dayShort, todayKey } from '../lib/dates';
import { round1, sumTotals } from '../lib/nutrition';
import { MEAL_COLORS, MEAL_LABELS, MEAL_ORDER } from '../types';
import type { FoodEntry, MealType } from '../types';
import { haptic } from '../lib/haptics';

function mealByTime(): MealType {
  const hour = new Date().getHours();
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 22) return 'dinner';
  return 'snack';
}

function Progress({ value, target, color }: { value: number; target: number; color: string }) {
  const percent = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const over = target > 0 && value > target;
  return (
    <div className="progress">
      <div
        className={`progress-fill ${over ? 'progress-over' : ''}`}
        style={{ width: `${percent}%`, background: over ? 'var(--danger)' : color }}
      />
    </div>
  );
}

export default function Home() {
  const { entries, settings, loading, error, removeEntry, changeEntryGrams, changeEntryMeal } =
    useData();
  const [date, setDate] = useState(todayKey);
  const [sheetMeal, setSheetMeal] = useState<MealType | null>(null);
  const [editing, setEditing] = useState<FoodEntry | null>(null);
  const [editGrams, setEditGrams] = useState('');
  const [editMeal, setEditMeal] = useState<MealType>('other');
  const [busy, setBusy] = useState(false);

  const dayEntries = useMemo(() => entries.filter((entry) => entry.date === date), [entries, date]);
  const totals = useMemo(() => sumTotals(dayEntries), [dayEntries]);
  const groups = useMemo(
    () =>
      MEAL_ORDER.map((meal) => ({
        meal,
        items: dayEntries.filter((entry) => entry.meal === meal),
      })).filter((group) => group.items.length > 0),
    [dayEntries],
  );

  const isToday = date === todayKey();

  function openEditor(entry: FoodEntry) {
    setEditing(entry);
    setEditGrams(String(entry.grams));
    setEditMeal(entry.meal);
    haptic();
  }

  async function saveEditing() {
    if (!editing) return;
    const grams = Number(editGrams);
    if (!Number.isFinite(grams) || grams <= 0) return;
    setBusy(true);
    try {
      if (grams !== editing.grams) await changeEntryGrams(editing, grams);
      if (editMeal !== editing.meal) await changeEntryMeal(editing, editMeal);
      setEditing(null);
      haptic();
    } finally {
      setBusy(false);
    }
  }

  async function removeEditing() {
    if (!editing) return;
    setBusy(true);
    try {
      await removeEntry(editing.id);
      setEditing(null);
      haptic([10, 30, 10]);
    } finally {
      setBusy(false);
    }
  }

  const per100 = editing
    ? {
        kcal: round1((editing.kcal / editing.grams) * 100),
        protein: round1((editing.protein / editing.grams) * 100),
        fat: round1((editing.fat / editing.grams) * 100),
        carbs: round1((editing.carbs / editing.grams) * 100),
      }
    : null;
  const editK = editing ? (Number(editGrams) || 0) / 100 : 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="icon-btn"
          aria-label="Предыдущий день"
          onClick={() => setDate((current) => addDays(current, -1))}
        >
          ‹
        </button>
        <div className="topbar-title">
          <span className="topbar-day">{dayLabel(date)}</span>
          <span className="topbar-date">{dayShort(date)}</span>
        </div>
        <button
          className="icon-btn"
          aria-label="Следующий день"
          onClick={() => setDate((current) => addDays(current, 1))}
        >
          ›
        </button>
      </header>

      <main className="content">
        {error && <div className="form-error">{error}</div>}

        <section className="summary-card">
          <div className="summary-head">
            <div>
              <div className="summary-kcal">{Math.round(totals.kcal)}</div>
              <div className="summary-caption">из {settings.targetKcal} ккал</div>
            </div>
            <div className={`summary-left ${totals.kcal > settings.targetKcal ? 'over' : ''}`}>
              {settings.targetKcal - Math.round(totals.kcal) >= 0
                ? `осталось ${settings.targetKcal - Math.round(totals.kcal)}`
                : `перебор ${Math.round(totals.kcal) - settings.targetKcal}`}
            </div>
          </div>
          <Progress value={totals.kcal} target={settings.targetKcal} color="var(--accent)" />

          <div className="macros">
            {(
              [
                ['protein', 'Б', totals.protein, settings.targetProtein, 'var(--protein)'],
                ['fat', 'Ж', totals.fat, settings.targetFat, 'var(--fat)'],
                ['carbs', 'У', totals.carbs, settings.targetCarbs, 'var(--carbs)'],
              ] as const
            ).map(([key, label, value, target, color]) => (
              <div className="macro" key={key}>
                <div className="macro-head">
                  <span>{label}</span>
                  <span>
                    <b>{Math.round(value)}</b> / {target} г
                  </span>
                </div>
                <Progress value={value} target={target} color={color} />
              </div>
            ))}
          </div>
        </section>

        {loading && dayEntries.length === 0 && <div className="empty">Загрузка…</div>}

        {!loading && groups.length === 0 && (
          <div className="empty">
            <div className="empty-icon">🍽</div>
            <p>Пока пусто. Нажми «+» и опиши, что съел.</p>
          </div>
        )}

        {groups.map((group) => (
          <section className="meal-group" key={group.meal}>
            <div className="meal-group-head">
              <span className="meal-dot" style={{ background: MEAL_COLORS[group.meal] }} />
              <h2>{MEAL_LABELS[group.meal]}</h2>
              <span className="meal-kcal">
                {Math.round(group.items.reduce((sum, item) => sum + item.kcal, 0))} ккал
              </span>
              <button className="link-btn" onClick={() => setSheetMeal(group.meal)}>
                + ещё
              </button>
            </div>

            {group.items.map((entry) => (
              <button className="entry-row" key={entry.id} onClick={() => openEditor(entry)}>
                <div className="entry-main">
                  <div className="entry-name">{entry.name}</div>
                  <div className="entry-meta">
                    {entry.grams} г
                    {entry.source === 'llm' && <span className="badge badge-llm">≈ ИИ</span>}
                    {entry.assumption && <span className="entry-assumption">{entry.assumption}</span>}
                  </div>
                </div>
                <div className="entry-kcal">{Math.round(entry.kcal)}</div>
              </button>
            ))}
          </section>
        ))}
      </main>

      <button className="fab" aria-label="Добавить еду" onClick={() => setSheetMeal(mealByTime())}>
        +
      </button>

      <NavBar />

      {sheetMeal && (
        <EntrySheet date={date} defaultMeal={sheetMeal} onClose={() => setSheetMeal(null)} />
      )}

      {editing && per100 && (
        <Modal title={editing.name} onClose={() => setEditing(null)}>
          <div className="sheet-body">
            <div className="field-row">
              <label className="field">
                <span>Вес, г</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={1}
                  value={editGrams}
                  onChange={(e) => setEditGrams(e.target.value)}
                  autoFocus
                />
              </label>
              <label className="field">
                <span>Приём пищи</span>
                <select
                  value={editMeal}
                  onChange={(e) => setEditMeal(e.target.value as MealType)}
                >
                  {MEAL_ORDER.map((meal) => (
                    <option key={meal} value={meal}>
                      {MEAL_LABELS[meal]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="edit-preview">
              <b>{Math.round(per100.kcal * editK)} ккал</b>
              <span>
                Б {round1(per100.protein * editK)} · Ж {round1(per100.fat * editK)} · У{' '}
                {round1(per100.carbs * editK)}
              </span>
            </div>

            <div className="sheet-actions">
              <button className="btn btn-primary" onClick={() => void saveEditing()} disabled={busy}>
                Сохранить
              </button>
              <button className="btn btn-danger" onClick={() => void removeEditing()} disabled={busy}>
                Удалить
              </button>
            </div>
          </div>
        </Modal>
      )}

      {!isToday && (
        <button className="today-pill" onClick={() => setDate(todayKey())}>
          вернуться к сегодня
        </button>
      )}
    </div>
  );
}
