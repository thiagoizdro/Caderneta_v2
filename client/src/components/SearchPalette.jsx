import { ArrowRight, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { money, shortDate } from '../lib/format.js';
import { navigate, useData } from '../state.jsx';
import { NAV_ITEMS } from './nav.js';
import { Icon } from './Icon.jsx';
import { CategoryIcon } from './ui.jsx';

const normalize = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function SearchPalette({ onClose, onOpenTx, onNewTx }) {
    const data = useData();
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const inputRef = useRef(null);

    useEffect(() => {
        inputRef.current?.focus();
        const onKey = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = '';
        };
    }, [onClose]);

    const results = useMemo(() => {
        const q = normalize(query.trim());
        const amountQuery = Number(query.replace(/\./g, '').replace(',', '.'));
        const out = [];

        const actions = [
            { key: 'new', section: 'Ações', title: 'Novo lançamento', icon: 'plus', run: () => onNewTx() },
            ...NAV_ITEMS.map((n) => ({ key: `nav-${n.path}`, section: 'Ir para', title: n.label, icon: n.icon, run: () => navigate(n.path) })),
        ];
        out.push(...actions.filter((a) => !q || normalize(a.title).includes(q)).slice(0, q ? 5 : 6));
        if (!q) return out;

        const txs = data.transactions.filter((t) => {
            const cat = data.categoryById.get(t.categoryId);
            return normalize(t.description).includes(q)
                || normalize(t.person).includes(q)
                || normalize(t.notes).includes(q)
                || normalize(cat?.name).includes(q)
                || (amountQuery > 0 && Math.abs(Number(t.amount) - amountQuery) < 0.005);
        }).slice(0, 12);
        out.push(...txs.map((t) => ({ key: t.id, section: 'Lançamentos', tx: t, run: () => onOpenTx(t) })));

        for (const a of data.accounts.filter((acc) => normalize(acc.name).includes(q)).slice(0, 4)) {
            out.push({ key: a.id, section: 'Contas', title: a.name, icon: a.type === 'credit' ? 'card' : 'wallet', run: () => navigate('/contas') });
        }
        for (const g of data.goals.filter((goal) => normalize(goal.name).includes(q)).slice(0, 4)) {
            out.push({ key: g.id, section: 'Metas', title: g.name, icon: g.icon || 'target', run: () => navigate('/metas') });
        }
        for (const c of data.categories.filter((cat) => normalize(cat.name).includes(q)).slice(0, 4)) {
            out.push({ key: `cat-${c.id}`, section: 'Categorias', title: `Lançamentos em ${c.name}`, category: c, run: () => navigate('/lancamentos', { categoria: c.id }) });
        }
        return out;
    }, [query, data, onNewTx, onOpenTx]);

    useEffect(() => setActive(0), [query]);

    function pick(item) {
        onClose();
        item.run();
    }

    function onKeyDown(e) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
        if (e.key === 'Enter' && results[active]) { e.preventDefault(); pick(results[active]); }
    }

    useEffect(() => {
        document.getElementById(`pal-${active}`)?.scrollIntoView({ block: 'nearest' });
    }, [active]);

    let lastSection = null;
    return (
        <div className="overlay top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className="palette" role="dialog" aria-modal="true" aria-label="Busca global">
                <div className="palette-input">
                    <Search size={18} className="muted" aria-hidden="true" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={onKeyDown}
                        placeholder="Buscar lançamentos, valores, contas, metas…"
                        aria-label="Buscar"
                        role="combobox"
                        aria-expanded="true"
                        aria-controls="palette-list"
                        aria-activedescendant={results[active] ? `pal-${active}` : undefined}
                    />
                    <kbd className="muted small">Esc</kbd>
                </div>
                <div className="palette-results" id="palette-list" role="listbox">
                    {results.length === 0 && <div className="palette-empty">Nada encontrado para "{query}".</div>}
                    {results.map((item, i) => {
                        const header = item.section !== lastSection ? <div className="palette-section">{item.section}</div> : null;
                        lastSection = item.section;
                        const cat = item.tx ? data.categoryById.get(item.tx.categoryId) : item.category;
                        return (
                            <div key={item.key}>
                                {header}
                                <button
                                    id={`pal-${i}`}
                                    role="option"
                                    aria-selected={i === active}
                                    className={`palette-item${i === active ? ' active' : ''}`}
                                    onMouseEnter={() => setActive(i)}
                                    onClick={() => pick(item)}
                                >
                                    {item.tx || item.category
                                        ? <CategoryIcon category={cat} size="sm" />
                                        : <span className="cat-icon sm"><Icon name={item.icon} size={15} /></span>}
                                    <span className="list-main">
                                        <span className="list-title">{item.tx ? item.tx.description : item.title}</span>
                                        {item.tx && <span className="list-sub">{shortDate(item.tx.date, data.today)} · {cat?.name || 'Transferência'}</span>}
                                    </span>
                                    {item.tx
                                        ? <span className={`list-amount ${item.tx.type === 'income' ? 'pos' : ''}`}>{money(item.tx.amount)}</span>
                                        : <ArrowRight size={16} className="muted" aria-hidden="true" />}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
