import {
    ArrowDownRight, ArrowLeftRight, ArrowUpRight, Baby, LayoutDashboard, Menu, Settings, Banknote, Bell, Book, Briefcase, Bus, CalendarDays,
    Car, ChartColumn, Coffee, CreditCard, Dog, Fuel, Gamepad2, Gift, GraduationCap, HandCoins, HeartPulse,
    House, Landmark, Laptop, Layers, Music, PartyPopper, PiggyBank, Pill, Plane, Plus, Receipt, Repeat, Shirt,
    ShoppingBag, Smartphone, Sparkles, Tag, Target, TrendingDown, TrendingUp, TriangleAlert, Utensils, Wallet, Zap,
} from 'lucide-react';

// Ícones que o usuário pode escolher para categorias, contas e metas.
export const PICKABLE_ICONS = {
    utensils: Utensils,
    coffee: Coffee,
    bus: Bus,
    car: Car,
    fuel: Fuel,
    home: House,
    zap: Zap,
    party: PartyPopper,
    gamepad: Gamepad2,
    music: Music,
    plane: Plane,
    repeat: Repeat,
    smartphone: Smartphone,
    heart: HeartPulse,
    pill: Pill,
    shopping: ShoppingBag,
    shirt: Shirt,
    gift: Gift,
    education: GraduationCap,
    book: Book,
    pet: Dog,
    baby: Baby,
    laptop: Laptop,
    tag: Tag,
    briefcase: Briefcase,
    wallet: Wallet,
    bank: Landmark,
    card: CreditCard,
    cash: Banknote,
    piggy: PiggyBank,
    coins: HandCoins,
    target: Target,
    plus: Plus,
};

const EXTRA = {
    trending: TrendingUp,
    up: TrendingUp,
    down: TrendingDown,
    calendar: CalendarDays,
    alert: TriangleAlert,
    receipt: Receipt,
    bell: Bell,
    sparkles: Sparkles,
    chart: ChartColumn,
    layers: Layers,
    income: ArrowUpRight,
    expense: ArrowDownRight,
    transfer: ArrowLeftRight,
    dashboard: LayoutDashboard,
    settings: Settings,
    menu: Menu,
};

export function Icon({ name, size = 18, ...props }) {
    const Cmp = PICKABLE_ICONS[name] || EXTRA[name] || Tag;
    return <Cmp size={size} strokeWidth={2} aria-hidden="true" {...props} />;
}

export const seriesColor = (slot) => `var(--series-${((Number(slot) || 1) - 1) % 8 + 1})`;
