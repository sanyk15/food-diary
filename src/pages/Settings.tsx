import { useEffect, useState } from 'react';
import NavBar from '../components/NavBar';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useTheme } from '../context/ThemeContext';
import type { ThemeMode } from '../context/ThemeContext';
import { fetchFreeModels, loadLlmConfig, saveLlmConfig } from '../lib/llm';
import type { FreeModel } from '../lib/llm';
import type { Settings as SettingsModel } from '../types';

const THEMES: Array<{ mode: ThemeMode; label: string }> = [
  { mode: 'light', label: 'Светлая' },
  { mode: 'dark', label: 'Тёмная' },
  { mode: 'system', label: 'Как в системе' },
];

export default function Settings() {
  const { signOut } = useAuth();
  const { settings, updateSettings, reseed, products } = useData();
  const { mode, setMode } = useTheme();

  const [form, setForm] = useState<SettingsModel>(settings);
  const [llm, setLlm] = useState(loadLlmConfig);
  const [models, setModels] = useState<FreeModel[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Данные могут догрузиться уже после открытия страницы — подхватываем их.
  useEffect(() => {
    setForm(settings);
  }, [settings]);

  function patchForm(patch: Partial<SettingsModel>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  async function saveTargets() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await updateSettings(form);
      setMessage('Цели сохранены.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить цели.');
    } finally {
      setBusy(false);
    }
  }

  function saveLlm() {
    saveLlmConfig(llm);
    setMessage('Настройки ИИ сохранены на этом устройстве.');
    setError(null);
  }

  async function loadModels() {
    setModelsBusy(true);
    setError(null);
    try {
      const list = await fetchFreeModels();
      setModels(list);
      if (!llm.model && list.length > 0) {
        setLlm((prev) => ({ ...prev, model: list[0].id }));
      }
      setMessage(`Найдено бесплатных моделей: ${list.length}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось получить список моделей.');
    } finally {
      setModelsBusy(false);
    }
  }

  async function handleReseed() {
    if (!window.confirm('Перезалить базовый справочник? Твои продукты и оценки ИИ останутся.')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const count = await reseed();
      setMessage(`Справочник обновлён: ${count} позиций.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось обновить справочник.');
    } finally {
      setBusy(false);
    }
  }

  const modelOptions = [...models];
  if (llm.model && !modelOptions.some((model) => model.id === llm.model)) {
    modelOptions.unshift({ id: llm.model, name: llm.model });
  }

  return (
    <div className="app-shell">
      <header className="topbar topbar-simple">
        <div className="topbar-title">
          <span className="topbar-day">Настройки</span>
        </div>
      </header>

      <main className="content">
        {message && <div className="form-ok">{message}</div>}
        {error && <div className="form-error">{error}</div>}

        <section className="card">
          <h2 className="card-title">Цели на день</h2>
          <div className="field-row">
            <label className="field">
              <span>Ккал</span>
              <input
                type="number"
                inputMode="numeric"
                value={form.targetKcal}
                onChange={(e) => patchForm({ targetKcal: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="field">
              <span>Белки, г</span>
              <input
                type="number"
                inputMode="numeric"
                value={form.targetProtein}
                onChange={(e) => patchForm({ targetProtein: Number(e.target.value) || 0 })}
              />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span>Жиры, г</span>
              <input
                type="number"
                inputMode="numeric"
                value={form.targetFat}
                onChange={(e) => patchForm({ targetFat: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="field">
              <span>Углеводы, г</span>
              <input
                type="number"
                inputMode="numeric"
                value={form.targetCarbs}
                onChange={(e) => patchForm({ targetCarbs: Number(e.target.value) || 0 })}
              />
            </label>
          </div>
          <button className="btn btn-primary" onClick={() => void saveTargets()} disabled={busy}>
            Сохранить цели
          </button>
        </section>

        <section className="card">
          <h2 className="card-title">ИИ для незнакомых блюд</h2>
          <p className="card-hint">
            Когда блюда нет в справочнике, КБЖУ оценивает бесплатная модель OpenRouter.
            Ключ хранится только на этом устройстве и не попадает в базу.
          </p>

          <label className="field">
            <span>Ключ OpenRouter</span>
            <input
              type="password"
              value={llm.apiKey}
              onChange={(e) => setLlm((prev) => ({ ...prev, apiKey: e.target.value }))}
              placeholder="sk-or-v1-..."
              autoComplete="off"
            />
          </label>

          <div className="field">
            <span>Бесплатная модель</span>
            <div className="model-row">
              <select
                value={llm.model}
                onChange={(e) => setLlm((prev) => ({ ...prev, model: e.target.value }))}
              >
                {modelOptions.length === 0 && <option value="">— список не загружен —</option>}
                {modelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id}
                  </option>
                ))}
              </select>
              <button className="btn btn-ghost" onClick={() => void loadModels()} disabled={modelsBusy}>
                {modelsBusy ? '…' : 'Обновить'}
              </button>
            </div>
          </div>

          <button className="btn btn-primary" onClick={saveLlm}>
            Сохранить ИИ
          </button>
        </section>

        <section className="card">
          <h2 className="card-title">Оформление</h2>
          <div className="segmented">
            {THEMES.map((theme) => (
              <button
                key={theme.mode}
                className={`segmented-item ${mode === theme.mode ? 'segmented-active' : ''}`}
                onClick={() => setMode(theme.mode)}
              >
                {theme.label}
              </button>
            ))}
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">Справочник</h2>
          <p className="card-hint">
            Сейчас в базе {products.length} позиций. Базовый набор можно залить заново —
            твои продукты и оценки ИИ не удалятся.
          </p>
          <button className="btn btn-ghost" onClick={() => void handleReseed()} disabled={busy}>
            Перезалить базовый справочник
          </button>
        </section>

        <section className="card">
          <button className="btn btn-danger btn-wide" onClick={() => void signOut()}>
            Выйти из аккаунта
          </button>
        </section>
      </main>

      <NavBar />
    </div>
  );
}
