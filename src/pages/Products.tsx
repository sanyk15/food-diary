import { useMemo, useState } from 'react';
import NavBar from '../components/NavBar';
import ProductForm from '../components/ProductForm';
import { useData } from '../context/DataContext';
import type { FoodProduct } from '../types';
import { CATEGORY_LABELS } from '../types';
import type { ProductInput } from '../lib/api';

export default function Products() {
  const { products, createProduct, editProduct, removeProduct, loading, error } = useData();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<FoodProduct | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/ё/g, 'е');
    const list = needle
      ? products.filter((product) =>
          [product.name, ...product.aliases].some((value) =>
            value.toLowerCase().replace(/ё/g, 'е').includes(needle),
          ),
        )
      : products;
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [products, query]);

  async function handleCreate(input: ProductInput) {
    await createProduct(input);
  }

  async function handleEdit(id: string, input: ProductInput) {
    await editProduct(id, input);
  }

  return (
    <div className="app-shell">
      <header className="topbar topbar-simple">
        <div className="topbar-title">
          <span className="topbar-day">Справочник</span>
          <span className="topbar-date">{products.length} позиций</span>
        </div>
        <button className="icon-btn" aria-label="Добавить продукт" onClick={() => setCreating(true)}>
          +
        </button>
      </header>

      <main className="content">
        <input
          className="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по названию или синониму"
        />

        {error && <div className="form-error">{error}</div>}
        {loading && products.length === 0 && <div className="empty">Загрузка…</div>}
        {!loading && filtered.length === 0 && (
          <div className="empty">
            <div className="empty-icon">🔍</div>
            <p>Ничего не нашлось.</p>
          </div>
        )}

        <div className="product-list">
          {filtered.map((product) => (
            <button className="product-row" key={product.id} onClick={() => setEditing(product)}>
              <div className="product-main">
                <div className="product-name">{product.name}</div>
                <div className="product-meta">
                  {CATEGORY_LABELS[product.category] ?? product.category}
                  {product.source === 'llm' && <span className="badge badge-llm">ИИ</span>}
                  {product.source === 'manual' && <span className="badge badge-manual">своё</span>}
                </div>
              </div>
              <div className="product-values">
                <b>{Math.round(product.kcal)}</b>
                <span>
                  Б {product.protein} · Ж {product.fat} · У {product.carbs}
                </span>
              </div>
            </button>
          ))}
        </div>
      </main>

      <button className="fab" aria-label="Добавить продукт" onClick={() => setCreating(true)}>
        +
      </button>

      <NavBar />

      {creating && (
        <ProductForm product={null} onSave={handleCreate} onClose={() => setCreating(false)} />
      )}

      {editing && (
        <ProductForm
          product={editing}
          onSave={(input) => handleEdit(editing.id, input)}
          onDelete={() => removeProduct(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
