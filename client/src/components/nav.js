import { useData } from '../state.jsx';

// Estrutura de navegação compartilhada por sidebar, barra inferior e busca.
export const NAV_ITEMS = [
    { path: '/', label: 'Início', icon: 'dashboard', group: 'main' },
    { path: '/lancamentos', label: 'Lançamentos', icon: 'receipt', group: 'main' },
    { path: '/calendario', label: 'Calendário', icon: 'calendar', group: 'main' },
    { path: '/diarias', label: 'Diárias e pagamentos', icon: 'coins', group: 'money', desc: 'Trabalhado, recebido e a receber', dailyOnly: true },
    { path: '/contas', label: 'Contas e cartões', icon: 'card', group: 'money', desc: 'Saldos, faturas e limites' },
    { path: '/recorrentes', label: 'Recorrentes e parcelas', icon: 'layers', group: 'money', desc: 'Contas fixas e compras parceladas' },
    { path: '/orcamento', label: 'Orçamento', icon: 'piggy', group: 'plan', desc: 'Limites por categoria' },
    { path: '/metas', label: 'Metas', icon: 'target', group: 'plan', desc: 'Objetivos e depósitos' },
    { path: '/relatorios', label: 'Relatórios', icon: 'chart', group: 'plan', desc: 'Gráficos e comparações' },
    { path: '/ajustes', label: 'Ajustes', icon: 'settings', group: 'system', desc: 'Modo, conta, backup e tema' },
];

export const NAV_GROUPS = { main: null, money: 'Dinheiro', plan: 'Planejamento', system: 'Sistema' };

/** Itens do menu: "Diárias e pagamentos" só aparece para quem usa diárias. */
export function useNavItems() {
    const { profile, workLedger } = useData();
    const daily = profile?.mode === 'daily' || workLedger.days.length > 0;
    return NAV_ITEMS.filter((item) => !item.dailyOnly || daily);
}
