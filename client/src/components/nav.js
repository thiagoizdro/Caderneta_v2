// Estrutura de navegação compartilhada por sidebar, barra inferior e busca.
export const NAV_ITEMS = [
    { path: '/', label: 'Início', icon: 'dashboard', group: 'main' },
    { path: '/lancamentos', label: 'Lançamentos', icon: 'receipt', group: 'main' },
    { path: '/calendario', label: 'Calendário', icon: 'calendar', group: 'main' },
    { path: '/contas', label: 'Contas e cartões', icon: 'card', group: 'money', desc: 'Saldos, faturas e limites' },
    { path: '/recorrentes', label: 'Recorrentes e parcelas', icon: 'layers', group: 'money', desc: 'Contas fixas e compras parceladas' },
    { path: '/orcamento', label: 'Orçamento', icon: 'piggy', group: 'plan', desc: 'Limites por categoria' },
    { path: '/metas', label: 'Metas', icon: 'target', group: 'plan', desc: 'Objetivos e depósitos' },
    { path: '/relatorios', label: 'Relatórios', icon: 'chart', group: 'plan', desc: 'Gráficos e comparações' },
    { path: '/ajustes', label: 'Ajustes', icon: 'settings', group: 'system', desc: 'Modo, conta, backup e tema' },
];

export const NAV_GROUPS = { main: null, money: 'Dinheiro', plan: 'Planejamento', system: 'Sistema' };
