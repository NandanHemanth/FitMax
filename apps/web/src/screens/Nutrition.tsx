import { useEffect, useMemo, useRef, useState } from 'react';
import { recipesFor, shoppingFromRecipes, type Recipe } from '../content/recipes';
import { AiUnavailable, aiConfigured, askAi, fileToDataUrl, type FridgeResult, type MealResult, type ShoppingResult } from '../lib/ai';
import { useApp } from '../state/app';
import { addFood, dietWarnings, foodsOn, lookupBarcode, portion, removeFood, searchFoods, totals, type FoodItem, type OffProduct } from '../state/food';
import { goalLabel } from '../state/profile';
import { IconBarcode, IconCamera, IconCart, IconCheck, IconFridge, IconMap, IconPlus, IconSearch, IconSparkle, IconX } from '../ui/icons';
import { Ring } from '../ui/viz';

type Sheet = null | 'barcode' | 'meal' | 'fridge' | 'search' | 'manual';

export function Nutrition() {
  const { profile, targets, setTab } = useApp();
  const [items, setItems] = useState<FoodItem[]>(() => foodsOn());
  const [sheet, setSheet] = useState<Sheet>(null);
  const [ai, setAi] = useState<boolean | null>(null);
  const [fridgeRecipes, setFridgeRecipes] = useState<FridgeResult | null>(null);

  useEffect(() => {
    void aiConfigured().then(setAi);
  }, []);

  const refresh = () => setItems(foodsOn());
  const t = totals(items);
  const recipes = useMemo(() => (profile ? recipesFor(profile.diet) : []), [profile]);
  if (!profile || !targets) return null;

  const left = Math.max(0, targets.proteinG - t.protein);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Nutrition · {goalLabel(profile.goal)}</p>
          <h1>Fuel the goal</h1>
          <p className="muted">
            {left > 0 ? `${Math.round(left)} g protein to go today.` : 'Protein target hit today.'} Targets from your profile: {targets.kcal} kcal and{' '}
            {targets.proteinPerKg} g protein per kg.
          </p>
        </div>
        {profile.diet.length > 0 && (
          <div className="chips">
            {profile.diet.map((d) => (
              <span key={d} className="pill data">
                {d}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid">
        <section className="card col-12">
          <div className="macro-rings">
            <Macro label="Calories" value={t.kcal} max={targets.kcal} unit="kcal" color="var(--accent)" />
            <Macro label="Protein" value={t.protein} max={targets.proteinG} unit="g" color="var(--good)" />
            <Macro label="Carbs" value={t.carbs} max={targets.carbsG} unit="g" color="var(--data)" />
            <Macro label="Fat" value={t.fat} max={targets.fatG} unit="g" color="var(--warn)" />
          </div>
        </section>

        <section className="col-12">
          <div className="action-grid">
            <button className="action" onClick={() => setSheet('barcode')}>
              <span className="ico">
                <IconBarcode />
              </span>
              <strong>Scan a barcode</strong>
              <span>Nutrition, Nutri-Score and diet checks from Open Food Facts</span>
            </button>
            <button className="action" onClick={() => setSheet('meal')}>
              <span className="ico">
                <IconCamera />
              </span>
              <strong>Snap your meal</strong>
              <span>AI estimates portions and macros from a photo</span>
            </button>
            <button className="action" onClick={() => setSheet('fridge')}>
              <span className="ico">
                <IconFridge />
              </span>
              <strong>Fridge to recipes</strong>
              <span>Photo of your fridge, three recipes for your goal</span>
            </button>
            <button className="action" onClick={() => setSheet('search')}>
              <span className="ico">
                <IconSearch />
              </span>
              <strong>Search food</strong>
              <span>Millions of products, or add your own</span>
            </button>
          </div>
        </section>

        <section className="card col-7">
          <div className="card-head">
            <h2>Today's log</h2>
            <button className="btn" onClick={() => setSheet('manual')}>
              <IconPlus size={16} /> Quick add
            </button>
          </div>
          {items.length === 0 ? (
            <p className="muted">Nothing logged yet. Scan, snap or search your first meal.</p>
          ) : (
            <ul className="list">
              {items.map((f) => (
                <li key={f.id} className="food-row">
                  <span className="food-thumb">{f.meta?.image ? <img src={f.meta.image} alt="" /> : <IconCheck size={18} />}</span>
                  <span style={{ minWidth: 0 }}>
                    <strong>{f.name}</strong>
                    <span className="macros-inline">
                      <span>{f.kcal} kcal</span>
                      <span className="good">{f.protein}g P</span>
                      <span>{f.carbs}g C</span>
                      <span>{f.fat}g F</span>
                      {f.grams ? <span>{f.grams} g</span> : null}
                    </span>
                    {f.meta?.warnings?.length ? <span className="tiny warn">{f.meta.warnings.join(' · ')}</span> : null}
                  </span>
                  <button
                    className="icon-btn"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => {
                      removeFood(f.id);
                      refresh();
                    }}
                  >
                    <IconX size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <ShoppingList recipes={recipes} ai={ai} />

        <section className="card col-12">
          <div className="card-head">
            <h2>Recipes for your goal</h2>
            <span className="tiny muted">
              {profile.diet.length ? `Filtered for ${profile.diet.join(', ')}` : 'Ranked by protein per calorie'} · macros per serving, approx.
            </span>
          </div>
          {fridgeRecipes && (
            <>
              <p className="small" style={{ marginBottom: 10 }}>
                <IconSparkle size={14} style={{ verticalAlign: '-2px' }} /> From your fridge: {fridgeRecipes.ingredients.slice(0, 10).join(', ')}
              </p>
              <div className="paper-grid" style={{ marginBottom: 14 }}>
                {fridgeRecipes.recipes.map((r) => (
                  <RecipeCard
                    key={r.title}
                    r={{ ...r, id: r.title, tags: {}, ingredients: r.uses.map((u) => ({ name: u, qty: '', section: 'Produce' })) }}
                    missing={r.missing}
                    onLog={() => {
                      addFood({ name: r.title, grams: null, kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat, source: 'recipe' });
                      refresh();
                    }}
                  />
                ))}
              </div>
            </>
          )}
          <div className="paper-grid">
            {recipes.slice(0, 6).map((r) => (
              <RecipeCard
                key={r.id}
                r={r}
                onLog={() => {
                  addFood({ name: r.title, grams: null, kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat, source: 'recipe' });
                  refresh();
                }}
              />
            ))}
            {recipes.length === 0 && <p className="muted">No built-in recipes match every restriction. Try Fridge to recipes for tailored ideas.</p>}
          </div>
        </section>

        <section className="card col-12 row" style={{ justifyContent: 'space-between' }}>
          <span>
            <strong>Where to shop</strong>
            <br />
            <span className="small muted">See healthy grocery stores near any home on the Places map.</span>
          </span>
          <button className="btn" onClick={() => setTab('places')}>
            <IconMap size={16} /> Open Places
          </button>
        </section>
      </div>

      {sheet && (
        <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && setSheet(null)}>
          <div className="sheet" role="dialog" aria-modal="true">
            {sheet === 'barcode' && <BarcodeSheet diet={profile.diet} onAdded={refresh} onClose={() => setSheet(null)} />}
            {sheet === 'search' && <SearchSheet diet={profile.diet} onAdded={refresh} onClose={() => setSheet(null)} />}
            {sheet === 'manual' && <ManualSheet onAdded={refresh} onClose={() => setSheet(null)} />}
            {sheet === 'meal' && <MealSheet ai={ai} onAdded={refresh} onClose={() => setSheet(null)} onManual={() => setSheet('manual')} />}
            {sheet === 'fridge' && (
              <FridgeSheet
                ai={ai}
                onResult={(r) => {
                  setFridgeRecipes(r);
                  setSheet(null);
                }}
                onClose={() => setSheet(null)}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Macro({ label, value, max, unit, color }: { label: string; value: number; max: number; unit: string; color: string }) {
  return (
    <div className="macro">
      <Ring value={value} max={max} size={104} stroke={10} color={color} label={`${Math.round(value)}`} sub={`of ${max}${unit === 'g' ? 'g' : ''}`} />
      <strong className="small">{label}</strong>
      <span className="tiny muted">{Math.max(0, Math.round(max - value))} {unit} left</span>
    </div>
  );
}

function RecipeCard({ r, onLog, missing }: { r: Recipe; onLog: () => void; missing?: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="recipe">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{r.title}</strong>
        <span className="pill">{r.minutes} min</span>
      </div>
      <span className="macros-inline">
        <span>{r.kcal} kcal</span>
        <span className="good">{r.protein}g protein</span>
        <span>{r.carbs}g C</span>
        <span>{r.fat}g F</span>
      </span>
      {missing?.length ? <span className="tiny warn">Need: {missing.join(', ')}</span> : null}
      {open && (
        <>
          {r.ingredients.length > 0 && (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {r.ingredients.map((i) => (
                <li key={i.name}>
                  {i.name} {i.qty && <span className="muted">· {i.qty}</span>}
                </li>
              ))}
            </ul>
          )}
          {'steps' in r && (
            <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {r.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
        </>
      )}
      <div className="row">
        <button className="btn" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'How to make'}
        </button>
        <button className="btn btn-primary" onClick={onLog}>
          <IconPlus size={16} /> Log
        </button>
      </div>
    </div>
  );
}

function ShoppingList({ recipes, ai }: { recipes: Recipe[]; ai: boolean | null }) {
  const { profile, targets } = useApp();
  const [list, setList] = useState<ShoppingResult | null>(() => {
    try {
      return JSON.parse(localStorage.getItem('fitmax.shopping') ?? 'null');
    } catch {
      return null;
    }
  });
  const [done, setDone] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = (l: ShoppingResult) => {
    setList(l);
    setDone([]);
    localStorage.setItem('fitmax.shopping', JSON.stringify(l));
  };

  const build = async (useAi: boolean) => {
    setErr('');
    if (!useAi || !profile || !targets) {
      save({ sections: shoppingFromRecipes(recipes), tip: 'Built from your top recipes: 3 servings each covers most of a week.' });
      return;
    }
    setBusy(true);
    try {
      save(await askAi<ShoppingResult>('shopping', { profile, targets }));
    } catch (e) {
      setErr(e instanceof AiUnavailable ? 'AI is not configured, so this list uses your recipes.' : (e as Error).message);
      save({ sections: shoppingFromRecipes(recipes), tip: 'Built from your top recipes.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card col-5">
      <div className="card-head">
        <h2>
          <IconCart size={18} style={{ verticalAlign: '-3px' }} /> Goal-based shopping list
        </h2>
      </div>
      {!list ? (
        <p className="muted small" style={{ marginBottom: 12 }}>
          A week of groceries sized to your calorie and protein targets and your diet.
        </p>
      ) : (
        <div style={{ maxHeight: 420, overflow: 'auto', marginBottom: 12 }}>
          {list.sections.map((s) => (
            <div key={s.title} className="shop-section">
              <h3>{s.title}</h3>
              {s.items.map((i) => {
                const k = s.title + i.name;
                return (
                  <label key={k} className="check-row">
                    <input type="checkbox" checked={done.includes(k)} onChange={() => setDone(done.includes(k) ? done.filter((x) => x !== k) : [...done, k])} />
                    <span style={{ textDecoration: done.includes(k) ? 'line-through' : 'none', opacity: done.includes(k) ? 0.6 : 1 }}>
                      <strong className="small">{i.name}</strong> <span className="small muted">{i.qty}</span>
                      <br />
                      <span className="tiny muted">{i.why}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          ))}
          {list.tip && <p className="tiny muted" style={{ marginTop: 8 }}>{list.tip}</p>}
        </div>
      )}
      {err && <p className="tiny warn" style={{ marginBottom: 8 }}>{err}</p>}
      <div className="row">
        <button className="btn btn-primary" disabled={busy} onClick={() => build(!!ai)}>
          <IconSparkle size={16} /> {busy ? 'Building…' : list ? 'Rebuild' : 'Build my list'}
        </button>
        {ai === false && <span className="tiny muted">AI off: using recipes</span>}
      </div>
    </section>
  );
}

/* ---------------- sheets ---------------- */

function SheetHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="card-head">
      <h2>{title}</h2>
      <button className="icon-btn" onClick={onClose} aria-label="Close">
        <IconX size={18} />
      </button>
    </div>
  );
}

function ProductPicker({ product, diet, onAdded, onClose }: { product: OffProduct; diet: string[]; onAdded: () => void; onClose: () => void }) {
  const [grams, setGrams] = useState(String(product.servingG ?? 100));
  const g = Number(grams) || 0;
  const p = portion(product, g);
  const warnings = dietWarnings(product, diet);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="product">
        {product.image ? <img src={product.image} alt="" /> : <span className="food-thumb" style={{ width: 72, height: 72 }} />}
        <div>
          <strong>{product.name}</strong>
          <div className="small muted">{product.brand}</div>
          <div className="row" style={{ marginTop: 6 }}>
            {product.nutriscore && ['a', 'b', 'c', 'd', 'e'].includes(product.nutriscore) && (
              <span className={`nutri nutri-${product.nutriscore}`} title="Nutri-Score">
                {product.nutriscore}
              </span>
            )}
            {product.nova && <span className="pill">NOVA {product.nova}</span>}
            <span className="pill">{product.per100.kcal} kcal / 100 g</span>
          </div>
        </div>
      </div>
      {warnings.length > 0 ? (
        <div className="pill warn" style={{ borderRadius: 12, padding: '8px 12px' }}>
          Check: {warnings.join(' · ')}
        </div>
      ) : diet.length > 0 ? (
        <div className="pill good" style={{ borderRadius: 12, padding: '8px 12px' }}>
          No conflicts found with your diet in this product's data
        </div>
      ) : null}
      <label className="field">
        <span>Amount (g)</span>
        <input className="input" inputMode="numeric" value={grams} onChange={(e) => setGrams(e.target.value.replace(/\D/g, ''))} />
      </label>
      <div className="macros-inline">
        <span>{p.kcal} kcal</span>
        <span className="good">{p.protein} g protein</span>
        <span>{p.carbs} g carbs</span>
        <span>{p.fat} g fat</span>
      </div>
      <button
        className="btn btn-primary btn-lg"
        disabled={!g}
        onClick={() => {
          addFood({ name: product.name, grams: g, ...p, source: 'barcode', meta: { brand: product.brand, nutriscore: product.nutriscore, nova: product.nova, warnings, image: product.image } });
          onAdded();
          onClose();
        }}
      >
        Add to today
      </button>
      <p className="tiny muted">Data: Open Food Facts (ODbL). Values per 100 g scaled to your amount.</p>
    </div>
  );
}

function BarcodeSheet({ diet, onAdded, onClose }: { diet: string[]; onAdded: () => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('Point the camera at a barcode');
  const [product, setProduct] = useState<OffProduct | null>(null);
  const [scanning, setScanning] = useState(true);

  const lookup = async (c: string) => {
    setScanning(false);
    setStatus(`Looking up ${c}…`);
    try {
      const p = await lookupBarcode(c);
      if (p) setProduct(p);
      else setStatus(`No product found for ${c}. Try search instead.`);
    } catch {
      setStatus('Could not reach Open Food Facts. Check your connection.');
    }
  };

  useEffect(() => {
    if (!scanning) return;
    let controls: { stop: () => void } | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, videoRef.current!, (result) => {
          if (result && !cancelled) {
            cancelled = true;
            controls?.stop();
            void lookup(result.getText());
          }
        });
        if (cancelled) controls.stop();
      } catch {
        setStatus('Camera unavailable here. Type the barcode number instead.');
      }
    })();
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [scanning]);

  return (
    <>
      <SheetHead title="Scan a barcode" onClose={onClose} />
      {product ? (
        <ProductPicker product={product} diet={diet} onAdded={onAdded} onClose={onClose} />
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {scanning && (
            <div className="scanner">
              <video ref={videoRef} playsInline muted />
              <div className="frame" />
            </div>
          )}
          <p className="small muted">{status}</p>
          <div className="row">
            <input className="input" style={{ flex: 1, minWidth: 0 }} inputMode="numeric" placeholder="Or type the barcode, e.g. 3017624010701" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <button className="btn btn-primary" disabled={code.length < 6} onClick={() => lookup(code)}>
              Look up
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function SearchSheet({ diet, onAdded, onClose }: { diet: string[]; onAdded: () => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<OffProduct[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<OffProduct | null>(null);
  const run = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      setResults(await searchFoods(q.trim()));
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SheetHead title="Search food" onClose={onClose} />
      {picked ? (
        <ProductPicker product={picked} diet={diet} onAdded={onAdded} onClose={onClose} />
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            <input className="input" style={{ flex: 1, minWidth: 0 }} autoFocus placeholder="e.g. greek yogurt, chicken breast" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn btn-primary" disabled={busy}>
              {busy ? '…' : 'Search'}
            </button>
          </form>
          {results && results.length === 0 && <p className="small muted">No matches. Try simpler words, or use Quick add.</p>}
          <ul className="list">
            {results?.map((p) => (
              <li key={p.code + p.name}>
                <button className="food-row" style={{ width: '100%', background: 'none', border: 0, padding: 0, textAlign: 'left' }} onClick={() => setPicked(p)}>
                  <span className="food-thumb">{p.image ? <img src={p.image} alt="" /> : null}</span>
                  <span>
                    <strong className="small">{p.name}</strong>
                    <br />
                    <span className="tiny muted">
                      {p.brand ?? ''} · {p.per100.kcal} kcal · {p.per100.protein} g protein per 100 g
                    </span>
                  </span>
                  <span className="tiny warn">{dietWarnings(p, diet)[0] ?? ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function ManualSheet({ onAdded, onClose, prefill }: { onAdded: () => void; onClose: () => void; prefill?: Partial<FoodItem> }) {
  const [f, setF] = useState({ name: prefill?.name ?? '', kcal: '', protein: '', carbs: '', fat: '' });
  const n = (s: string) => Number(s) || 0;
  return (
    <>
      <SheetHead title="Quick add" onClose={onClose} />
      <div className="form-grid">
        <label className="field full">
          <span>Food</span>
          <input className="input" placeholder="e.g. Protein shake" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        {(['kcal', 'protein', 'carbs', 'fat'] as const).map((k) => (
          <label key={k} className="field">
            <span>{k === 'kcal' ? 'Calories (kcal)' : `${k[0].toUpperCase()}${k.slice(1)} (g)`}</span>
            <input className="input" inputMode="decimal" placeholder="0" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value.replace(/[^\d.]/g, '') })} />
          </label>
        ))}
      </div>
      <button
        className="btn btn-primary btn-lg btn-block"
        style={{ marginTop: 14 }}
        disabled={!f.name.trim()}
        onClick={() => {
          addFood({ name: f.name.trim(), grams: null, kcal: n(f.kcal), protein: n(f.protein), carbs: n(f.carbs), fat: n(f.fat), source: 'manual' });
          onAdded();
          onClose();
        }}
      >
        Add to today
      </button>
    </>
  );
}

function PhotoPicker({ onPicked, label }: { onPicked: (dataUrl: string) => void; label: string }) {
  return (
    <label className="action" style={{ minHeight: 140, placeItems: 'center', justifyItems: 'center', textAlign: 'center', cursor: 'pointer' }}>
      <span className="ico">
        <IconCamera />
      </span>
      <strong>{label}</strong>
      <span>Take a photo or choose one</span>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) onPicked(await fileToDataUrl(file));
        }}
      />
    </label>
  );
}

function AiOff({ onManual }: { onManual?: () => void }) {
  return (
    <div className="pill warn" style={{ borderRadius: 12, padding: '10px 12px', display: 'block' }}>
      Photo AI needs an NVIDIA key on the server: add <code>NVIDIA_API_KEY</code> to <code>apps/web/.env</code> and restart. {onManual && (
        <button className="btn" style={{ marginTop: 8 }} onClick={onManual}>
          Add manually instead
        </button>
      )}
    </div>
  );
}

function MealSheet({ ai, onAdded, onClose, onManual }: { ai: boolean | null; onAdded: () => void; onClose: () => void; onManual: () => void }) {
  const { profile, targets } = useApp();
  const [img, setImg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<MealResult | null>(null);
  const [keep, setKeep] = useState<number[]>([]);
  const [err, setErr] = useState('');

  const analyze = async (dataUrl: string) => {
    setImg(dataUrl);
    if (!profile || !targets) return;
    setBusy(true);
    setErr('');
    try {
      const r = await askAi<MealResult>('meal', { image: dataUrl, profile, targets });
      setRes(r);
      setKeep(r.items.map((_, i) => i));
    } catch (e) {
      setErr(e instanceof AiUnavailable ? 'unavailable' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SheetHead title="Snap your meal" onClose={onClose} />
      <div style={{ display: 'grid', gap: 12 }}>
        {ai === false && <AiOff onManual={onManual} />}
        {!img ? <PhotoPicker label="Photo of your meal" onPicked={analyze} /> : <img src={img} alt="Your meal" className="preview-img" />}
        {busy && <p className="small muted">Estimating portions and macros…</p>}
        {err === 'unavailable' ? <AiOff onManual={onManual} /> : err ? <p className="small warn">{err}</p> : null}
        {res && (
          <>
            <ul className="list">
              {res.items.map((it, i) => (
                <li key={i}>
                  <label className="check-row" style={{ borderTop: 0, padding: 0 }}>
                    <input type="checkbox" checked={keep.includes(i)} onChange={() => setKeep(keep.includes(i) ? keep.filter((x) => x !== i) : [...keep, i])} />
                    <span>
                      <strong className="small">{it.name}</strong> <span className="small muted">~{Math.round(it.grams)} g</span>
                      <br />
                      <span className="macros-inline">
                        <span>{Math.round(it.kcal)} kcal</span>
                        <span className="good">{Math.round(it.protein)}g P</span>
                        <span>{Math.round(it.carbs)}g C</span>
                        <span>{Math.round(it.fat)}g F</span>
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {res.notes && <p className="small">{res.notes}</p>}
            <p className="tiny muted">AI estimates from a photo can be off by a fair margin. Adjust if you know the portion.</p>
            <button
              className="btn btn-primary btn-lg"
              disabled={!keep.length}
              onClick={() => {
                res.items.filter((_, i) => keep.includes(i)).forEach((it) =>
                  addFood({ name: it.name, grams: Math.round(it.grams), kcal: Math.round(it.kcal), protein: Math.round(it.protein), carbs: Math.round(it.carbs), fat: Math.round(it.fat), source: 'photo' }),
                );
                onAdded();
                onClose();
              }}
            >
              Add {keep.length} {keep.length === 1 ? 'item' : 'items'}
            </button>
          </>
        )}
      </div>
    </>
  );
}

function FridgeSheet({ ai, onResult, onClose }: { ai: boolean | null; onResult: (r: FridgeResult) => void; onClose: () => void }) {
  const { profile, targets } = useApp();
  const [img, setImg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async (dataUrl: string) => {
    setImg(dataUrl);
    if (!profile || !targets) return;
    setBusy(true);
    setErr('');
    try {
      onResult(await askAi<FridgeResult>('fridge', { image: dataUrl, profile, targets }));
    } catch (e) {
      setErr(e instanceof AiUnavailable ? 'unavailable' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SheetHead title="Fridge to recipes" onClose={onClose} />
      <div style={{ display: 'grid', gap: 12 }}>
        {ai === false && <AiOff />}
        {!img ? <PhotoPicker label="Photo of your fridge or pantry" onPicked={go} /> : <img src={img} alt="Your fridge" className="preview-img" />}
        {busy && <p className="small muted">Spotting ingredients and building recipes for your goal…</p>}
        {err === 'unavailable' ? <AiOff /> : err ? <p className="small warn">{err}</p> : null}
      </div>
    </>
  );
}
