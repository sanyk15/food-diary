import { useEffect, useMemo, useState } from 'react';
import NavBar from '../components/NavBar';
import { useData } from '../context/DataContext';
import { todayKey } from '../lib/dates';
import { buildAdvice, buildSummary } from '../lib/advice';
import type { Advice } from '../lib/advice';
import { adviseNutrition, loadLlmConfig } from '../lib/llm';
import { haptic } from '../lib/haptics';

const TONE_ICON: Record<Advice['tone'], string> = {
  good: '✓',
  info: '💡',
  warn: '⚠️',
};

const RANGES = [7, 14, 30];

export default function AdvicePage() {
  const { entries, products, settings, updateSettings } = useData();
  const [days, setDays] = useState(7);
  const [tips, setTips] = useState<string[] | null>(settings.adviceTips);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = todayKey();

  // Советы приходят из аккаунта: на другом устройстве они подставятся сами.
  useEffect(() => {
    if (!tips && settings.adviceTips) setTips(settings.adviceTips);
  }, [settings.adviceTips, tips]);

  const advice = useMemo(
    () => buildAdvice({ entries, products, settings, today, days }),
    [entries, products, settings, today, days],
  );

  async function askLlm() {
    const config = loadLlmConfig();
    if (!config.apiKey || !config.model) {
      setError('Добавь ключ и модель OpenRouter в настройках.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const summary = buildSummary({ entries, products, settings, today, days });
      const next = await adviseNutrition(summary, config);
      setTips(next);
      try {
        await updateSettings({
          ...settings,
          adviceTips: next,
          adviceUpdatedAt: new Date().toISOString(),
        });
      } catch {
        // Советы показываем локально, даже если не удалось сохранить в аккаунт.
      }
      haptic([10, 30, 10]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось получить советы.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar topbar-simple">
        <div className="topbar-title">
          <span className="topbar-day">Советы</span>
          <span className="topbar-date">по последним {days} дням</span>
        </div>
      </header>

      <main className="content">
        <div className="segmented">
          {RANGES.map((range) => (
            <button
              key={range}
              className={`segmented-item ${days === range ? 'segmented-active' : ''}`}
              onClick={() => setDays(range)}
            >
              {range} дней
            </button>
          ))}
        </div>

        <section className="advice-list">
          {advice.map((item) => (
            <div className={`advice-card advice-${item.tone}`} key={item.id}>
              <div className="advice-icon">{TONE_ICON[item.tone]}</div>
              <div>
                <div className="advice-title">{item.title}</div>
                <div className="advice-text">{item.text}</div>
              </div>
            </div>
          ))}
        </section>

        <section className="card">
          <h2 className="card-title">Разбор через ИИ</h2>
          <p className="card-hint">
            Отправит сводку за {days} дней бесплатной модели OpenRouter и вернёт 3 персональных
            совета. Один запрос, ничего не сохраняется на сервере.
          </p>
          <button className="btn btn-primary" onClick={() => void askLlm()} disabled={busy}>
            {busy ? 'Думаю…' : tips ? 'Обновить советы' : 'Получить советы'}
          </button>

          {error && <div className="form-error">{error}</div>}

          {tips && (
            <div className="llm-tips">
              {tips.map((tip, index) => (
                <div className="llm-tip" key={index}>
                  <span className="llm-tip-num">{index + 1}</span>
                  <span>{tip}</span>
                </div>
              ))}
            </div>
          )}

          {tips && settings.adviceUpdatedAt && (
            <div className="advice-updated">
              Сохранено{' '}
              {new Date(settings.adviceUpdatedAt).toLocaleString('ru-RU', {
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          )}
        </section>

        <p className="hint">
          Это ориентир, а не медицинская рекомендация. Локальные подсказки считаются по твоим
          записям и ничего никуда не отправляют.
        </p>
      </main>

      <NavBar />
    </div>
  );
}
