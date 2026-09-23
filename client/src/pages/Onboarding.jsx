import { ArrowLeft, Briefcase, CalendarDays, Cloud, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { AuthForm } from '../components/AuthForm.jsx';
import { importBackupFile } from '../lib/backup.js';
import { saveProfile } from '../lib/bootstrap.js';
import { DEFAULT_ACCOUNT_ID } from '../lib/defaults.js';
import { parseAmount } from '../lib/format.js';
import { useUI } from '../state.jsx';

function Steps({ step }) {
    return (
        <div className="steps" aria-hidden="true">
            {[0, 1, 2].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}
        </div>
    );
}

export function Onboarding() {
    const ui = useUI();
    const [step, setStep] = useState('welcome');
    const [mode, setMode] = useState(null);
    const [value, setValue] = useState('');
    const [payday, setPayday] = useState(5);
    const [error, setError] = useState('');
    const fileRef = useRef(null);

    async function finish(e) {
        e.preventDefault();
        const amount = parseAmount(value);
        if (!(amount > 0)) return setError(mode === 'daily' ? 'Informe um valor de diária válido.' : 'Informe um valor de salário válido.');
        await saveProfile({
            mode,
            dailyRate: mode === 'daily' ? amount : 0,
            monthlySalary: mode === 'monthly' ? amount : 0,
            payday: Number(payday) || 5,
            workAccountId: DEFAULT_ACCOUNT_ID,
            salaryAccountId: DEFAULT_ACCOUNT_ID,
            onboarded: true,
        });
        ui.toast('Tudo pronto! Bem-vindo ao Caderneta.', 'success');
    }

    async function onImport(e) {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const res = await importBackupFile(file);
            ui.toast(`Backup restaurado (${res.count} registros).`, 'success');
        } catch (err) {
            ui.toast(err.message, 'error');
        }
    }

    return (
        <div className="onboarding">
            <div className="onboarding-inner">
                {step === 'welcome' && (
                    <>
                        <div className="intro">
                            <span className="eyebrow">Caderneta digital</span>
                            <div className="stamp-mark" aria-hidden="true">R$</div>
                            <h1>Seu dinheiro, anotado direitinho.</h1>
                            <p>Diárias, salário, contas, cartões, metas e previsões — funcionando até sem internet.</p>
                        </div>
                        <div className="card stack">
                            <button className="btn btn-primary btn-block" onClick={() => setStep('mode')}>Começar agora</button>
                            <button className="btn btn-secondary btn-block" onClick={() => setStep('login')}>
                                <Cloud size={17} /> Já tenho conta
                            </button>
                            <div className="divider-text">ou</div>
                            <button className="btn btn-ghost btn-block" onClick={() => fileRef.current?.click()}>
                                <Upload size={17} /> Restaurar um backup (.json)
                            </button>
                            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onImport} />
                            <p className="hint center">Sem conta, tudo fica salvo só neste aparelho. Você pode criar uma conta depois para sincronizar.</p>
                        </div>
                    </>
                )}

                {step === 'login' && (
                    <>
                        <button className="btn btn-ghost btn-sm" onClick={() => setStep('welcome')}><ArrowLeft size={16} /> Voltar</button>
                        <div className="intro mt">
                            <div className="stamp-mark" aria-hidden="true"><Cloud size={28} /></div>
                            <h1>Entre na sua conta</h1>
                            <p>Seus lançamentos voltam para este aparelho automaticamente.</p>
                        </div>
                        <div className="card">
                            <AuthForm onDone={() => setStep('after-login')} />
                        </div>
                    </>
                )}

                {step === 'after-login' && (
                    <>
                        <div className="intro">
                            <div className="stamp-mark" aria-hidden="true">✓</div>
                            <h1>Conta conectada</h1>
                            <p>Se esta conta já tinha dados, eles aparecem em instantes. Se é nova, escolha como quer controlar.</p>
                        </div>
                        <button className="btn btn-primary btn-block" onClick={() => setStep('mode')}>Configurar agora</button>
                    </>
                )}

                {step === 'mode' && (
                    <>
                        <Steps step={1} />
                        <div className="intro">
                            <span className="eyebrow">Passo 1 de 2</span>
                            <h1>Como você quer controlar?</h1>
                            <p>Escolha o modo que melhor se adapta à sua realidade financeira. Dá para trocar depois.</p>
                        </div>
                        <div className="mode-cards">
                            <button className="mode-card" onClick={() => { setMode('daily'); setStep('config'); }}>
                                <span className="cat-icon lg"><CalendarDays size={22} /></span>
                                <span>
                                    <h2>Diária</h2>
                                    <p>Controle por dia trabalhado, com valor definido por dia. Marque os dias no calendário.</p>
                                    <span className="tag green">Recomendado para freelancers</span>
                                </span>
                            </button>
                            <button className="mode-card" onClick={() => { setMode('monthly'); setStep('config'); }}>
                                <span className="cat-icon lg"><Briefcase size={22} /></span>
                                <span>
                                    <h2>Salário Mensal</h2>
                                    <p>Seu salário entra sozinho todo mês e você controla o que sai.</p>
                                    <span className="tag green">Recomendado para CLT</span>
                                </span>
                            </button>
                        </div>
                        <button className="btn btn-ghost btn-block mt" onClick={() => setStep('welcome')}><ArrowLeft size={16} /> Voltar</button>
                    </>
                )}

                {step === 'config' && (
                    <>
                        <Steps step={2} />
                        <div className="intro">
                            <span className="eyebrow">{mode === 'daily' ? 'Modo Diária' : 'Modo Salário Mensal'}</span>
                            <div className="stamp-mark" aria-hidden="true">R$</div>
                            <h1>{mode === 'daily' ? 'Qual é a sua diária?' : 'Qual é o seu salário?'}</h1>
                            <p>
                                {mode === 'daily'
                                    ? 'Esse valor é a base do seu controle — cada dia marcado no calendário vira uma receita.'
                                    : 'Ele entra automaticamente como receita no dia do pagamento, todo mês.'}
                            </p>
                        </div>
                        <form className="card" onSubmit={finish}>
                            <div className="field">
                                <label className="label" htmlFor="ob-value">{mode === 'daily' ? 'Valor da diária' : 'Salário líquido mensal'}</label>
                                <div className="input-affix lg">
                                    <input
                                        id="ob-value"
                                        className="input input-lg"
                                        inputMode="decimal"
                                        placeholder="0,00"
                                        value={value}
                                        onChange={(e) => { setValue(e.target.value.replace(/[^\d.,]/g, '')); setError(''); }}
                                        autoFocus
                                    />
                                    <span className="affix">R$</span>
                                </div>
                                <span className="hint">Você pode alterar esse valor depois, em Ajustes.</span>
                            </div>
                            {mode === 'monthly' && (
                                <div className="field">
                                    <label className="label" htmlFor="ob-payday">Dia do pagamento</label>
                                    <input id="ob-payday" type="number" min={1} max={31} className="input" value={payday} onChange={(e) => setPayday(e.target.value)} />
                                </div>
                            )}
                            {error && <div className="callout danger mt" role="alert">{error}</div>}
                            <button type="submit" className="btn btn-primary btn-block mt">{mode === 'daily' ? 'Começar a registrar' : 'Começar a controlar'}</button>
                            <button type="button" className="btn btn-ghost btn-block" onClick={() => setStep('mode')} style={{ marginTop: 8 }}><ArrowLeft size={16} /> Voltar</button>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
}
