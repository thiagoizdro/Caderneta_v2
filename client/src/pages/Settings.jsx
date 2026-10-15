import { Bell, Cloud, Download, DatabaseBackup, FileSpreadsheet, LogOut, RefreshCw, Trash2, Undo2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AuthForm } from '../components/AuthForm.jsx';
import { Topbar, applyTheme } from '../components/Topbar.jsx';
import { exportBackup, exportMigrationBackup, exportTransactionsCsv, importBackupFile } from '../lib/backup.js';
import { getMigrationBackup, getMigrationReport, reapplyV3Migration, revertV3Migration, saveProfile } from '../lib/bootstrap.js';
import { isCredit } from '../lib/finance.js';
import { money, parseAmount, round2, shortDate } from '../lib/format.js';
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
    const { profile, activeAccounts, workdays, today } = useData();
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
            // Só muda o valor das diárias do mês: nenhuma movimentação é alterada.
            const ym = today.slice(0, 7);
            const days = workdays.filter((w) => w.date.startsWith(ym) && round2(w.amount) !== round2(r));
            await saveMany('workdays', days.map((w) => ({ ...w, amount: round2(r) })));
        }
        ui.toast('Modo de controle salvo. Suas movimentações foram preservadas.', 'success');
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
                    <label className="label" htmlFor="set-acc">{mode === 'daily' ? 'Recebimentos das diárias entram em' : 'O salário entra em'}</label>
                    <select id="set-acc" className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                        {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    {mode === 'daily' && <span className="hint">Dias trabalhados não entram no saldo. O dinheiro conta quando você registra o recebimento como receita.</span>}
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
            <p className="small soft">Avisos de contas planejadas chegando, orçamento no limite e, no modo Diária, um lembrete para marcar o dia.</p>
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
                    <span className="list-main"><strong>Exportar backup (.json)</strong><span>Tudo: movimentações, diárias, planejamento, contas, metas e ajustes.</span></span>
                </button>
                <button className="settings-item" onClick={() => exportTransactionsCsv(data.transactions, data)}>
                    <span className="cat-icon sm"><FileSpreadsheet size={15} /></span>
                    <span className="list-main"><strong>Exportar movimentações (.csv)</strong><span>Abre no Excel e no Google Planilhas.</span></span>
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

const REVIEW_LABELS = {
    'legacy-workday': 'Diária antiga já somada no saldo',
    'possible-duplicate': 'Possível duplicação',
    'bill-paid': 'Conta quitada (saiu do planejamento)',
    'bill-partial': 'Conta paga em parte',
    'odd-workpayment': 'Pagamento não alterado',
};

/** Relatório da migração 3.0, cópia de segurança e "desfazer". */
function MigrationSection() {
    const ui = useUI();
    const { profile, transactions } = useData();
    const [report, setReport] = useState(null);
    const [hasBackup, setHasBackup] = useState(false);
    const [showAll, setShowAll] = useState(false);

    const load = () => {
        getMigrationReport().then(setReport);
        getMigrationBackup().then((b) => setHasBackup(Boolean(b)));
    };
    useEffect(load, [transactions.length]);

    const runs = report?.runs || [];
    const applied = runs.filter((r) => !r.reverted && !r.aborted);
    const last = runs[runs.length - 1];
    const review = applied.flatMap((r) => r.review || []);
    const reverted = profile?.migrationV3 === 'reverted';

    async function download() {
        const backup = await getMigrationBackup();
        if (!backup) return ui.toast('Nenhuma cópia de segurança neste aparelho.', 'warn');
        exportMigrationBackup(backup);
    }

    async function undo() {
        const ok = await ui.confirm({
            title: 'Desfazer a atualização das diárias?',
            message: 'As diárias voltam a ser lançamentos "a receber", os pagamentos voltam a ser transferências e as contas voltam ao valor anterior. Os saldos não mudam. A atualização não roda de novo sozinha até você reaplicar.',
            confirmLabel: 'Desfazer',
            danger: true,
        });
        if (!ok) return;
        const plan = await revertV3Migration();
        load();
        ui.toast(`Atualização desfeita (${plan.txRestores.length + plan.txRevives.length} lançamentos restaurados).`, 'success');
    }

    async function reapply() {
        const run = await reapplyV3Migration();
        load();
        ui.toast(run?.aborted ? 'Não aplicada: os saldos não bateram.' : 'Atualização aplicada.', run?.aborted ? 'error' : 'success');
    }

    return (
        <Section id="atualizacao" title="Atualização 3.0">
            <p className="small soft">Diárias e planejamento ficaram separados das movimentações. Só receitas e despesas reais mudam o saldo.</p>
            {!runs.length && <p className="hint mt">Nada precisou ser convertido neste aparelho.</p>}
            {last && (
                <div className="migration-report mt">
                    <div className="summary-strip">
                        <span>Última execução <b>{new Date(last.at).toLocaleString('pt-BR')}</b></span>
                        {last.reverted && <span className="tag">Desfeita</span>}
                        {last.aborted && <span className="tag red">Adiada</span>}
                    </div>
                    {applied.length > 0 && (
                        <table className="data-table mt">
                            <tbody>
                                <tr><td>Dias trabalhados criados</td><td className="r num">{applied.reduce((a, r) => a + (r.counts.workdaysCreated || 0), 0)}</td></tr>
                                <tr><td>Diárias "a receber" retiradas das movimentações</td><td className="r num">{applied.reduce((a, r) => a + (r.counts.receivableWorkdaysRemoved || 0), 0)}</td></tr>
                                <tr><td>Pagamentos de diárias convertidos em receita</td><td className="r num">{applied.reduce((a, r) => a + (r.counts.paymentsConverted || 0), 0)}</td></tr>
                                <tr><td>Diárias antigas mantidas como receita</td><td className="r num">{applied.reduce((a, r) => a + (r.counts.legacyWorkdays || 0), 0)}</td></tr>
                                <tr><td>Despesas de contas pagas preservadas</td><td className="r num">{applied[applied.length - 1].counts.billPaymentTxsKept}</td></tr>
                                <tr><td>Saldo antes → depois</td><td className="r num">{money(applied[0].balance.before)} → {money(applied[0].balance.after)}</td></tr>
                            </tbody>
                        </table>
                    )}
                    {last.aborted && (
                        <div className="callout danger mt">
                            Os saldos não bateram ({last.balance.mismatches.map((m) => `${m.name}: ${money(m.before)} → ${money(m.after)}`).join('; ')}). Nada foi alterado.
                        </div>
                    )}
                    {review.length > 0 && (
                        <>
                            <h3 className="label mt">Para revisar ({review.length})</h3>
                            <div className="list">
                                {(showAll ? review : review.slice(0, 6)).map((r, i) => (
                                    <div className="list-row" key={`${r.id}-${i}`}>
                                        <span className="list-main">
                                            <span className="review-head">
                                                <strong>{REVIEW_LABELS[r.kind] || r.kind}{r.description ? ` · ${r.description}` : ''}</strong>
                                                <span className="num">{money(r.amount)}</span>
                                            </span>
                                            {r.date && <span className="list-sub">{shortDate(r.date)}</span>}
                                            <span className="review-note">{r.note}</span>
                                        </span>
                                    </div>
                                ))}
                            </div>
                            {review.length > 6 && <button className="btn btn-ghost btn-sm" onClick={() => setShowAll(!showAll)}>{showAll ? 'Mostrar menos' : `Mostrar todos (${review.length})`}</button>}
                        </>
                    )}
                </div>
            )}
            <div className="settings-list mt">
                {hasBackup && (
                    <button className="settings-item" onClick={download}>
                        <span className="cat-icon sm"><DatabaseBackup size={15} /></span>
                        <span className="list-main"><strong>Baixar cópia de antes da atualização</strong><span>Tudo como estava antes da migração (pode ser restaurado em Backup).</span></span>
                    </button>
                )}
                {applied.length > 0 && !reverted && (
                    <button className="settings-item" onClick={undo}>
                        <span className="cat-icon sm" style={{ '--c': 'var(--red)' }}><Undo2 size={15} /></span>
                        <span className="list-main"><strong>Desfazer atualização</strong><span>Volta diárias, pagamentos e contas ao formato anterior.</span></span>
                    </button>
                )}
                {reverted && (
                    <button className="settings-item" onClick={reapply}>
                        <span className="cat-icon sm"><RefreshCw size={15} /></span>
                        <span className="list-main"><strong>Aplicar atualização de novo</strong><span>Separa novamente as diárias das movimentações.</span></span>
                    </button>
                )}
            </div>
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
                    <MigrationSection />
                    <p className="hint center">Caderneta 3.0 · {transactions.length} movimentações neste aparelho</p>
                </div>
            </div>
        </div>
    );
}
