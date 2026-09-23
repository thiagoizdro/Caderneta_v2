// Registros iniciais com ids fixos: se dois aparelhos criarem os padrões antes
// de sincronizar, eles viram o mesmo registro em vez de duplicar. O updatedAt
// antigo (1) garante que qualquer edição real do usuário vença na sincronização.

export const SEED_UPDATED_AT = 1;

export const PROFILE_ID = 'profile';

export const CATEGORY_IDS = {
    food: 'cat-alimentacao',
    transport: 'cat-transporte',
    home: 'cat-casa',
    leisure: 'cat-lazer',
    subscriptions: 'cat-assinaturas',
    health: 'cat-saude',
    other: 'cat-outros',
    work: 'cat-trabalho',
    salary: 'cat-salario',
    otherIncome: 'cat-outras-receitas',
};

// `color` é o slot da paleta categórica (1–8), resolvido em CSS por tema.
export const DEFAULT_CATEGORIES = [
    { id: CATEGORY_IDS.food, name: 'Alimentação', kind: 'expense', icon: 'utensils', color: 1 },
    { id: CATEGORY_IDS.transport, name: 'Transporte', kind: 'expense', icon: 'bus', color: 2 },
    { id: CATEGORY_IDS.home, name: 'Casa', kind: 'expense', icon: 'home', color: 3 },
    { id: CATEGORY_IDS.leisure, name: 'Lazer', kind: 'expense', icon: 'party', color: 4 },
    { id: CATEGORY_IDS.subscriptions, name: 'Assinaturas', kind: 'expense', icon: 'repeat', color: 5 },
    { id: CATEGORY_IDS.health, name: 'Saúde', kind: 'expense', icon: 'heart', color: 6 },
    { id: CATEGORY_IDS.other, name: 'Outros', kind: 'expense', icon: 'tag', color: 7 },
    { id: CATEGORY_IDS.work, name: 'Diárias', kind: 'income', icon: 'briefcase', color: 1 },
    { id: CATEGORY_IDS.salary, name: 'Salário', kind: 'income', icon: 'wallet', color: 3 },
    { id: CATEGORY_IDS.otherIncome, name: 'Outras receitas', kind: 'income', icon: 'plus', color: 6 },
];

export const DEFAULT_ACCOUNT_ID = 'acc-carteira';

export const DEFAULT_ACCOUNTS = [
    { id: DEFAULT_ACCOUNT_ID, name: 'Carteira', type: 'wallet', initialBalance: 0, color: 3 },
];

export const ACCOUNT_TYPES = {
    wallet: 'Carteira',
    checking: 'Conta corrente',
    savings: 'Poupança',
    credit: 'Cartão de crédito',
    other: 'Outra conta',
};

export const SALARY_RECURRENCE_ID = 'rec-salario';
