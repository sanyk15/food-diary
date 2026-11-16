import { useState } from 'react';
import Modal from './Modal';
import { BASIS_LABELS, CATEGORY_LABELS, CATEGORY_ORDER } from '../types';
import type { Basis, FoodProduct } from '../types';
import type { ProductInput } from '../lib/api';

interface Props {
  product: FoodProduct | null;
  onSave: (input: ProductInput) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

export default function ProductForm({ product, onSave, onDelete, onClose }: Props) {
  const [name, setName] = useState(product?.name ?? '');
  const [aliases, setAliases] = useState((product?.aliases ?? []).join(', '));
  const [category, setCategory] = useState(product?.category ?? 'dish');
  const [basis, setBasis] = useState<Basis>(product?.basis ?? 'ready');
  const [kcal, setKcal] = useState(String(product?.kcal ?? 0));
  const [protein, setProtein] = useState(String(product?.protein ?? 0));
  const [fat, setFat] = useState(String(product?.fat ?? 0));
  const [carbs, setCarbs] = useState(String(product?.carbs ?? 0));
  const [pieceGrams, setPieceGrams] = useState(
    product?.pieceGrams === null || product?.pieceGrams === undefined ? '' : String(product.pieceGrams),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (!name.trim()) {
      setError('Название не может быть пустым.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSave({
        name: name.trim(),
        aliases: aliases
          .split(',')
          .map((alias) => alias.trim())
          .filter(Boolean),
        category,
        kcal: Number(kcal) || 0,
        protein: Number(protein) || 0,
        fat: Number(fat) || 0,
        carbs: Number(carbs) || 0,
        pieceGrams: pieceGrams.trim() ? Number(pieceGrams) || null : null,
        basis,
        source: product?.source ?? 'manual',
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    if (!window.confirm(`Удалить «${product?.name}» из справочника?`)) return;
    setBusy(true);
    try {
      await onDelete();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={product ? 'Изменить продукт' : 'Новый продукт'} onClose={onClose}>
      <div className="sheet-body">
        <label className="field">
          <span>Название</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>

        <label className="field">
          <span>Синонимы (через запятую)</span>
          <input
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="гречка, гречневая каша"
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Категория</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORY_ORDER.map((key) => (
                <option key={key} value={key}>
                  {CATEGORY_LABELS[key]}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Вес</span>
            <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
              {(Object.keys(BASIS_LABELS) as Basis[]).map((key) => (
                <option key={key} value={key}>
                  {BASIS_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Ккал / 100 г</span>
            <input type="number" inputMode="decimal" value={kcal} onChange={(e) => setKcal(e.target.value)} />
          </label>
          <label className="field">
            <span>Белки</span>
            <input type="number" inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Жиры</span>
            <input type="number" inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} />
          </label>
          <label className="field">
            <span>Углеводы</span>
            <input type="number" inputMode="decimal" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span>Вес одной штуки, г (необязательно)</span>
          <input
            type="number"
            inputMode="decimal"
            value={pieceGrams}
            onChange={(e) => setPieceGrams(e.target.value)}
            placeholder="например, 55 для яйца"
          />
        </label>

        {error && <div className="form-error">{error}</div>}

        <div className="sheet-actions">
          <button className="btn btn-primary" onClick={() => void handleSave()} disabled={busy}>
            Сохранить
          </button>
          {onDelete && (
            <button className="btn btn-danger" onClick={() => void handleDelete()} disabled={busy}>
              Удалить
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
