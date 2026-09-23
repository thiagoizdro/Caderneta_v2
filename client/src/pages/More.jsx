import { Topbar } from '../components/Topbar.jsx';
import { NAV_ITEMS } from '../components/nav.js';
import { Icon } from '../components/Icon.jsx';

// Menu "Mais" do celular: tudo o que não cabe na barra inferior.
export function More() {
    const items = NAV_ITEMS.filter((n) => n.group !== 'main');
    return (
        <div className="page">
            <Topbar eyebrow="Caderneta" title="Mais" />
            <div className="more-grid">
                {items.map((n) => (
                    <a key={n.path} href={`#${n.path}`} className="card more-tile">
                        <span className="cat-icon" style={{ '--c': 'var(--green)' }}><Icon name={n.icon} /></span>
                        <span>
                            <strong style={{ display: 'block' }}>{n.label}</strong>
                            <span>{n.desc}</span>
                        </span>
                    </a>
                ))}
            </div>
        </div>
    );
}
