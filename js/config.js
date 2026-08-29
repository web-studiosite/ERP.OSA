/**
 * OSA — Configuration
 * Central configuration for the OSA system
 */

const OSA_CONFIG = {
  // Supabase — REPLACE with your own project credentials
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',

  // App metadata
  APP_NAME: 'OSA',
  APP_FULL_NAME: 'OFFICIAL SHOP ADMINISTRATOR',
  APP_VERSION: '1.0.0',

  // Currency
  CURRENCY: 'MZN',
  CURRENCY_LOCALE: 'pt-MZ',

  // Pagination
  DEFAULT_PAGE_SIZE: 20,

  // Roles
  ROLES: {
    admin: { label: 'Administrador', level: 3 },
    junior_admin: { label: 'Admin Júnior', level: 2 },
    cashier: { label: 'Caixa', level: 1 }
  },

  // Movement types
  MOVEMENT_TYPES: {
    entry: 'Entrada',
    transfer_out: 'Saída (Transferência)',
    transfer_in: 'Entrada (Transferência)',
    sale: 'Venda',
    return: 'Devolução',
    loss: 'Perda',
    theft: 'Furto',
    inventory_adjustment: 'Ajuste de Inventário',
    authorized_correction: 'Correção Autorizada'
  },

  // Locations
  LOCATIONS: {
    warehouse: 'Armazém',
    store: 'Loja'
  },

  // Payment methods
  PAYMENT_METHODS: {
    cash: 'Dinheiro',
    card: 'Cartão',
    mpesa: 'M-Pesa',
    emola: 'e-Mola',
    bank_transfer: 'Transferência Bancária',
    other: 'Outro'
  },

  // Price methods
  PRICE_METHODS: {
    margin_percentage: 'Margem sobre Custo',
    direct_price: 'Preço Direto'
  },

  // Transfer statuses
  TRANSFER_STATUSES: {
    pending: 'Pendente',
    completed: 'Concluída',
    cancelled: 'Cancelada'
  },

  // Date filters
  DATE_FILTERS: [
    { key: 'today', label: 'Hoje', days: 0 },
    { key: 'yesterday', label: 'Ontem', days: 1 },
    { key: 'last7', label: 'Últimos 7 dias', days: 7 },
    { key: 'last30', label: 'Últimos 30 dias', days: 30 },
    { key: 'this_month', label: 'Mês Atual', days: null },
    { key: 'custom', label: 'Personalizado', days: null }
  ]
};

// Freeze to prevent mutation
Object.freeze(OSA_CONFIG);
