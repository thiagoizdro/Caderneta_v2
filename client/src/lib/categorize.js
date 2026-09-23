import { CATEGORY_IDS } from './defaults.js';

// Sugestão de categoria por palavras-chave — regra simples, sem IA.
// Também aprende com o histórico: se o usuário já classificou "padaria" como
// Alimentação, a próxima "padaria" sugere o mesmo.
const KEYWORDS = [
    [CATEGORY_IDS.food, ['mercado', 'supermercado', 'padaria', 'pão', 'pao', 'pães', 'restaurante', 'lanche', 'almoço', 'almoco', 'jantar', 'ifood', 'pizza', 'açougue', 'acougue', 'feira', 'café', 'cafe', 'hortifruti', 'marmita', 'comida']],
    [CATEGORY_IDS.transport, ['uber', '99', 'gasolina', 'combustível', 'combustivel', 'ônibus', 'onibus', 'metrô', 'metro', 'passagem', 'estacionamento', 'pedágio', 'pedagio', 'oficina', 'posto', 'táxi', 'taxi']],
    [CATEGORY_IDS.home, ['aluguel', 'condomínio', 'condominio', 'luz', 'energia', 'água', 'agua', 'gás', 'gas', 'internet', 'iptu', 'móveis', 'moveis', 'limpeza', 'reforma']],
    [CATEGORY_IDS.leisure, ['cinema', 'show', 'bar', 'viagem', 'passeio', 'festa', 'jogo', 'ingresso', 'hotel']],
    [CATEGORY_IDS.subscriptions, ['netflix', 'spotify', 'assinatura', 'prime', 'disney', 'youtube', 'icloud', 'google one', 'hbo', 'max', 'academia', 'celular', 'plano']],
    [CATEGORY_IDS.health, ['farmácia', 'farmacia', 'remédio', 'remedio', 'médico', 'medico', 'consulta', 'exame', 'dentista', 'plano de saúde', 'hospital', 'psicólogo', 'psicologo']],
    [CATEGORY_IDS.salary, ['salário', 'salario', 'holerite', 'pagamento empresa']],
    [CATEGORY_IDS.work, ['diária', 'diaria', 'freela', 'serviço', 'servico']],
];

const INCOME_CATEGORIES = new Set([CATEGORY_IDS.salary, CATEGORY_IDS.work]);

const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export function suggestCategory(description, history = [], kind = 'expense') {
    const text = normalize(description || '');
    if (text.length < 2) return null;

    // 1. Histórico do próprio usuário (lançamento mais recente com a mesma descrição).
    const match = history.find((t) => t.categoryId && t.type === kind && normalize(t.description || '') === text);
    if (match) return match.categoryId;

    // 2. Palavras-chave.
    const words = new Set(text.split(/[^a-z0-9]+/).filter(Boolean));
    for (const [categoryId, keys] of KEYWORDS) {
        if (INCOME_CATEGORIES.has(categoryId) !== (kind === 'income')) continue;
        for (const key of keys) {
            const k = normalize(key);
            if (k.includes(' ') ? text.includes(k) : words.has(k)) return categoryId;
        }
    }
    return null;
}
