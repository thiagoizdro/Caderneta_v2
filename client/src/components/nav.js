import { useData } from '../state.jsx';

// Estrutura de navegação compartilhada por sidebar, barra inferior e busca.
export const NAV_ITEMS = [
    { path: '/', label: 'Início', icon: 'dashboard', group: 'main', desc: 'Quanto tenho, gastei e preciso juntar' },
    { path: '/movimentacoes', label: 'Movimentações', icon: 'receipt', group: 'main', desc: 'Receitas, despesas e histórico' },
    { path: '/diarias', label: 'Diárias', icon: 'calendar', group: 'main', desc: 'Calendário, dias trabalhados e a receber', dailyOnly: true },
    { path: '/planejamento', label: 'Planejamento', icon: 'target', group: 'main', desc: 'Quanto preciso juntar para as contas' },
    { path: '/contas', label: 'Contas e cartões', icon: 'card', group: 'money', desc: 'Saldos, faturas e limites' },
    { path: '/recorrentes', label: 'Recorrentes e parcelas', icon: 'layers', group: 'money', desc: 'Contas fixas e compras parceladas' },
    { path: '/orcamento', label: 'Orçamento', icon: 'piggy', group: 'plan', desc: 'Limites por categoria' },
    { path: '/metas', label: 'Metas', icon: 'target', group: 'plan', desc: 'Objetivos e depósitos' },
    { path: '/relatorios', label: 'Relatórios', icon: 'chart', group: 'plan', desc: 'Gráficos e comparações' },
    { path: '/ajustes', label: 'Ajustes', icon: 'settings', group: 'system', desc: 'Modo, conta, backup e tema' },
];

export const NAV_GROUPS = { main: null, money: 'Dinheiro', plan: 'Análise', system: 'Sistema' };

/** Itens do menu: "Diárias" só aparece para quem usa diárias. */
export function useNavItems() {
    const { profile, workdays } = useData();
    const daily = profile?.mode === 'daily' || workdays.length > 0;
    return NAV_ITEMS.filter((item) => !item.dailyOnly || daily);
}
