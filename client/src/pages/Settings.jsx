import { Bell, Cloud, Download, FileSpreadsheet, LogOut, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AuthForm } from '../components/AuthForm.jsx';
import { Topbar, applyTheme } from '../components/Topbar.jsx';
import { exportBackup, exportTransactionsCsv, importBackupFile } from '../lib/backup.js';
import { saveProfile } from '../lib/bootstrap.js';
import { isCredit, isWorkday } from '../lib/finance.js';
import { parseAmount, round2 } from '../lib/format.js';
import { notificationsEnabled, notificationsSupported, requestNotifications } from '../lib/notify.js';
import { saveMany } from '../lib/store.js';
import { deleteAccount, getSyncState, logout, syncNow, wipeLocalData } from '../lib/sync.js';
import { useData, useSyncState, useUI } from '../state.jsx';

function Section({ id, title, children }) {
    return (
        <section className="card" id={id}>
            <div className="card-head"><h2>{title}</h2></div>
            {children}
        </section>
    );
}

function ModeSection() {
    const { profile, activeAccounts, transactions, today } = useData();
    const ui = useUI();
    const [mode, setMode] = useState(profile.mode);
    const [rate, setRate] = useState(String(profile.dailyRate || '').replace('.', ','));
    const [salary, setSalary] = useState(String(profile.monthlySalary || '').replace('.', ','));
    const [payday, setPayday] = useState(profile.payday || 5);
    const cashAccounts = activeAccounts.filter((a) => !isCredit(a));
    const [accountId, setAccountId] = useState(profile.workAccountId || profile.salaryAccountId || cashAccounts[0]?.id || '');
    const [applyMonth, setApplyMonth] = useState(false);

    async function submit(e) {
        e.preventDefault();
        const r = parseAmount(rate);
        const s = parseAmount(salary);
        if (mode === 'daily' && !(r > 0)) return ui.toast('Informe um valor de diária válido.', 'error');
        if (mode === 'monthly' && !(s > 0)) return ui.toast('Informe um salário válido.', 'error');
        await saveProfile({
            ...profile,
            mode,
            dailyRate: r > 0 ? round2(r) : profile.dailyRate || 0,
            monthlySalary: s > 0 ? round2(s) : profile.monthlySalary || 0,
            payday: Number(payday) || 5,
            workAccountId: accountId,
            salaryAccountId: accountId,
        });
        if (mode === 'daily' && applyMonth) {
            const ym = today.slice(0, 7);
            const days = transactions.filter((t) => isWorkday(t) && t.date.startsWith(ym));
            await saveMany('transactions', days.map((t) => ({ ...t, amount: round2(r) })));
        }
        ui.toast('Modo de controle salvo. Seus lançamentos foram preservados.', 'success');
    }

    return (
        <Section id="modo" title="Modo de controle">
            <form onSubmit={submit}>
                <div className="segmented">
                    <button type="button" className={mode === 'daily' ? 'active' : ''} onClick={() => setMode('daily')}>Diária</button>
                    <button type="button" className={mode === 'monthly' ? 'active' : ''} onClick={() => setMode('monthly')}>Salário Mensal</button>
                </div>
                {mode === 'daily' ? (
                    <>
                        <div className="field mt">
                            <label className="label" htmlFor="set-rate">Valor da diária</label>
                            <div className="input-affix"><input id="set-rate" className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /><span className="affix">R$</span></div>
                            <span className="hint">Dias já marcados guardam o valor da época. Um novo valor vale para os próximos dias.</span>
                        </div>
                        <label className="switch">
                            <span className="switch-text"><strong>Aplicar aos dias deste mês</strong><span>Atualiza os dias já marcados no mês atual.</span></span>
                            <input type="checkbox" checked={applyMonth} onChange={(e) => setApplyMonth(e.target.checked)} />
                        </label>
                    </>
                ) : (
                    <div className="field-row mt">
                        <div className="field">
                            <label className="label" htmlFor="set-salary">Salário mensal</label>
                            <div className="input-affix"><input id="set-salary" className="input" inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} /><span className="affix">R$</span></div>
                        </div>
                        <div className="field">
                            <label className="label" htmlFor="set-payday">Dia do pagamento</label>
                            <input id="set-payday" type="number" min={1} max={31} className="input" value={payday} onChange={(e) => setPayday(e.target.value)} />
                        </div>
                    </div>
                )}
                <div className="field">
                    <label className="label" htmlFor="set-acc">{mode === 'daily' ? 'As diárias entram em' : 'O salário entra em'}</label>
                    <select id="set-acc" className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                        {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                </div>
                <button type="submit" className="btn btn-primary mt">Salvar modo</button>
            </form>
        </Section>
    );
}

function AccountSection() {
    const sync = useSyncState();
    const ui = useUI();

    async function onLogout() {
        const ok = await ui.confirm({
            title: 'Sair da conta?',
            message: sync.pending
                ? `Há ${sync.pending} alterações ainda não enviadas. Elas serão perdidas se você sair offline. Os demais dados continuam na nuvem.`
                : 'Os dados continuam salvos na nuvem e serão removidos deste aparelho.',
            confirmLabel: 'Sair',
            danger: Boolean(sync.pending),
        });
        if (!ok) return;
        await logout();
        window.location.hash = '/';
        window.location.reload();
    }

    async function onDeleteAccount() {
        const password = window.prompt('Para excluir a conta e todos os dados da nuvem, digite sua senha:');
        if (!password) return;
        try {
            await deleteAccount(password);
            window.location.hash = '/';
            window.location.reload();
        } catch (err) {
            ui.toast(err.message, 'error');
        }
    }

    if (!sync.user) {
        return (
            <Section id="conta" title="Conta e sincronização">
                <div className="callout info" style={{ marginBottom: 14 }}>
                    <Cloud size={16} />
                    <span>Hoje seus dados estão só neste aparelho. Com uma conta, eles ficam salvos na nuvem e sincronizam entre celular e computador — e o app continua funcionando offline.</span>
                </div>
                <AuthForm initialMode="register" onDone={() => ui.toast('Conta conectada. Sincronizando…', 'success')} />
            </Section>
        );
    }

    const statusText = {
        syncing: 'Sincronizando…',
        synced: `Sincronizado${sync.lastSync ? ` às ${new Date(sync.lastSync).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}`,
        offline: 'Offline — as alterações serão enviadas quando a conexão voltar',
        error: sync.error || 'Erro ao sincronizar',
        expired: sync.error,
    }[sync.status];

    return (
        <Section id="conta" title="Conta e sincronização">
            <div className="row">
                <span className="avatar">{sync.user.name.slice(0, 1).toUpperCase()}</span>
                <span className="list-main">
                    <span className="list-title">{sync.user.name}</span>
                    <span className="list-sub">{sync.user.email}</span>
                </span>
            </div>
            <p className="small soft mt">{statusText}{sync.pending > 0 && sync.status !== 'syncing' ? ` · ${sync.pending} alteraç${sync.pending === 1 ? 'ão pendente' : 'ões pendentes'}` : ''}</p>
            {sync.status === 'expired' && <div className="mt"><AuthForm onDone={() => ui.toast('Sessão renovada.', 'success')} /></div>}
            <div className="row wrap mt">
                <button className="btn btn-secondary btn-sm" onClick={() => syncNow()}><RefreshCw size={15} /> Sincronizar agora</button>
                <button className="btn btn-ghost btn-sm" onClick={onLogout}><LogOut size={15} /> Sair</button>
                <button className="btn btn-ghost btn-sm" onClick={onDeleteAccount} style={{ color: 'var(--red)' }}>Excluir conta</button>
            </div>
        </Section>
    );
}

function ThemeSection() {
    const [theme, setTheme] = useState(() => {
        try { return localStorage.getItem('caderneta:theme') || 'system'; } catch { return 'system'; }
    });
    const pick = (t) => { applyTheme(t); setTheme(t); };
    return (
        <Section id="aparencia" title="Aparência">
            <div className="segmented">
                {[['system', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(([id, label]) => (
                    <button key={id} className={theme === id ? 'active' : ''} onClick={() => pick(id)}>{label}</button>
                ))}
            </div>
        </Section>
    );
}

function NotificationsSection() {
    const ui = useUI();
    const [enabled, setEnabled] = useState(notificationsEnabled());
    async function enable() {
        const res = await requestNotifications();
        if (res === 'granted') {
            setEnabled(true);
            ui.toast('Lembretes ativados.', 'success');
        } else if (res === 'unsupported') {
            ui.toast('Este navegador não tem suporte a notificações.', 'error');
        } else {
            ui.toast('Permissão de notificação negada.', 'error');
        }
    }
    return (
        <Section id="lembretes" title="Lembretes">
            <p className="small soft">Avisos de contas vencendo, orçamento chegando no limite e, no modo Diária, um lembrete para marcar o dia.</p>
            <button className="btn btn-secondary btn-sm mt" onClick={enable} disabled={enabled || !notificationsSupported()}>
                <Bell size={15} /> {enabled ? 'Lembretes ativados' : 'Ativar lembretes'}
            </button>
        </Section>
    );
}

function BackupSection() {
    const data = useData();
    const ui = useUI();
    const fileRef = useRef(null);

    async function onFile(e) {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const res = await importBackupFile(file);
            ui.toast(res.kind === 'v1'
                ? `Backup da versão anterior convertido (${res.count} lançamentos).`
                : `Backup restaurado (${res.count} registros).`, 'success');
        } catch (err) {
            ui.toast(err.message, 'error');
        }
    }

    async function onWipe() {
        const ok = await ui.confirm({
            title: 'Apagar os dados deste aparelho?',
            message: getSyncState().user
                ? 'Você sairá da conta. Os dados na nuvem continuam guardados.'
                : 'Sem conta, isso apaga tudo definitivamente. Exporte um backup antes se quiser guardar.',
            confirmLabel: 'Apagar tudo',
            danger: true,
        });
        if (!ok) return;
        await wipeLocalData();
        window.location.hash = '/';
        window.location.reload();
    }

    return (
        <Section id="backup" title="Backup e exportação">
            <div className="settings-list">
                <button className="settings-item" onClick={() => exportBackup().then(() => ui.toast('Backup exportado.', 'success'))}>
                    <span className="cat-icon sm"><Download size={15} /></span>
                    <span className="list-main"><strong>Exportar backup (.json)</strong><span>Tudo: lançamentos, contas, metas e ajustes.</span></span>
                </button>
                <button className="settings-item" onClick={() => exportTransactionsCsv(data.transactions, data)}>
                    <span className="cat-icon sm"><FileSpreadsheet size={15} /></span>
                    <span className="list-main"><strong>Exportar lançamentos (.csv)</strong><span>Abre no Excel e no Google Planilhas.</span></span>
                </button>
                <button className="settings-item" onClick={() => fileRef.current?.click()}>
                    <span className="cat-icon sm"><Upload size={15} /></span>
                    <span className="list-main"><strong>Restaurar backup</strong><span>Aceita backups da 2.x e da versão anterior do Caderneta.</span></span>
                </button>
                <button className="settings-item" onClick={onWipe}>
                    <span className="cat-icon sm" style={{ '--c': 'var(--red)' }}><Trash2 size={15} /></span>
                    <span className="list-main"><strong style={{ color: 'var(--red)' }}>Apagar dados deste aparelho</strong><span>Recomeça o Caderneta do zero neste navegador.</span></span>
                </button>
            </div>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onFile} />
        </Section>
    );
}

export function Settings({ params }) {
    const { transactions } = useData();
    useEffect(() => {
        if (params.secao) document.getElementById(params.secao)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [params.secao]);

    return (
        <div className="page">
            <Topbar eyebrow="Configurações" title="Ajustes" />
            <div className="grid grid-2">
                <div className="stack" style={{ gap: 18, alignContent: 'start' }}>
                    <AccountSection />
                    <ModeSection />
                </div>
                <div className="stack" style={{ gap: 18, alignContent: 'start' }}>
                    <ThemeSection />
                    <NotificationsSection />
                    <BackupSection />
                    <p className="hint center">Caderneta 2.2 · {transactions.length} lançamentos neste aparelho</p>
                </div>
            </div>
        </div>
    );
}
