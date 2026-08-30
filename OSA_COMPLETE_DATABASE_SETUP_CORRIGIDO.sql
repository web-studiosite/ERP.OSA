-- ============================================================
-- OSA — Official Shop Administrator
-- COMPLETE DATABASE SETUP (Schema + RLS)
-- PostgreSQL / Supabase — Single-store ERP
-- Run this ONE file in Supabase SQL Editor
-- Idempotent: safe to re-run (drops everything first)
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- PHASE 1: FULL CLEANUP (idempotent reset)
-- Drop in reverse dependency order (children first, parents last)
-- ============================================================

-- Drop RLS policies (dynamic — removes ALL public schema policies)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename);
  END LOOP;
END;
$$;

-- Disable RLS on all tables (in case they exist)
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE IF EXISTS %I.%I DISABLE ROW LEVEL SECURITY',
      'public', t.tablename);
  END LOOP;
END;
$$;

-- Drop triggers (dynamic — only if the table actually exists)
DO $$
DECLARE
  t RECORD;
BEGIN
  -- auth.users trigger (Supabase internal table)
  IF EXISTS (SELECT 1 FROM information_schema.triggers WHERE event_object_table = 'users' AND trigger_schema = 'auth' AND trigger_name = 'on_auth_user_created') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users';
  END IF;
  -- public schema triggers — auto-dropped by DROP TABLE CASCADE below,
  -- but we clean them here for completeness
  FOR t IN
    SELECT trigger_schema, event_object_table, trigger_name
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I',
      t.trigger_name, t.trigger_schema, t.event_object_table);
  END LOOP;
END;
$$;

-- Drop functions (dynamic — handles overloaded signatures)
DO $$
DECLARE
  f RECORD;
BEGIN
  FOR f IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'handle_new_user', 'process_sale', 'process_transfer',
        'get_stock_balance', 'current_user_role',
        'is_admin', 'is_junior_admin', 'update_updated_at'
      )
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s)',
      f.nspname, f.proname, f.args);
  END LOOP;
END;
$$;

-- Drop views
DROP VIEW IF EXISTS public.v_stock_warehouse;
DROP VIEW IF EXISTS public.v_stock_store;

-- Drop sequences
DROP SEQUENCE IF EXISTS public.sale_ref_seq;
DROP SEQUENCE IF EXISTS public.transfer_ref_seq;

-- Drop tables (reverse dependency order)
DROP TABLE IF EXISTS public.audit_logs CASCADE;
DROP TABLE IF EXISTS public.daily_closings CASCADE;
DROP TABLE IF EXISTS public.fuel_records CASCADE;
DROP TABLE IF EXISTS public.thefts CASCADE;
DROP TABLE IF EXISTS public.losses CASCADE;
DROP TABLE IF EXISTS public.inventory_items CASCADE;
DROP TABLE IF EXISTS public.inventories CASCADE;
DROP TABLE IF EXISTS public.cash_movements CASCADE;
DROP TABLE IF EXISTS public.sale_items CASCADE;
DROP TABLE IF EXISTS public.sales CASCADE;
DROP TABLE IF EXISTS public.cash_registers CASCADE;
DROP TABLE IF EXISTS public.transfer_items CASCADE;
DROP TABLE IF EXISTS public.transfers CASCADE;
DROP TABLE IF EXISTS public.stock_movements CASCADE;
DROP TABLE IF EXISTS public.products CASCADE;
DROP TABLE IF EXISTS public.categories CASCADE;
DROP TABLE IF EXISTS public.configs CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- Drop types
DROP TYPE IF EXISTS public.app_role;
DROP TYPE IF EXISTS public.movement_type;
DROP TYPE IF EXISTS public.transfer_status;
DROP TYPE IF EXISTS public.cash_movement_type;
DROP TYPE IF EXISTS public.inventory_status;
DROP TYPE IF EXISTS public.closing_status;
DROP TYPE IF EXISTS public.price_method;

-- ============================================================
-- PHASE 2: SCHEMA — Custom Types
-- ============================================================

CREATE TYPE public.app_role AS ENUM ('admin', 'junior_admin', 'cashier');
CREATE TYPE public.movement_type AS ENUM (
  'entry',
  'transfer_out',
  'transfer_in',
  'sale',
  'return',
  'loss',
  'theft',
  'inventory_adjustment',
  'authorized_correction'
);
CREATE TYPE public.transfer_status AS ENUM ('pending', 'completed', 'cancelled');
CREATE TYPE public.cash_movement_type AS ENUM ('open', 'sale', 'expense', 'withdrawal', 'adjustment', 'close');
CREATE TYPE public.inventory_status AS ENUM ('open', 'completed', 'cancelled');
CREATE TYPE public.closing_status AS ENUM ('open', 'closed');
CREATE TYPE public.price_method AS ENUM ('margin_percentage', 'direct_price');

-- ============================================================
-- PHASE 2: PROFILES
-- ============================================================

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role public.app_role NOT NULL DEFAULT 'cashier',
  active BOOLEAN NOT NULL DEFAULT true,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Novo Utilizador'),
    COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'cashier')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- PHASE 2: CONFIGS
-- ============================================================

CREATE TABLE public.configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_name TEXT NOT NULL DEFAULT 'Minha Loja',
  logo_url TEXT,
  cover_image_url TEXT,
  accent_color TEXT DEFAULT '#2563eb',
  currency TEXT NOT NULL DEFAULT 'MZN',
  locale TEXT NOT NULL DEFAULT 'pt-MZ',
  default_margin NUMERIC(5,2) NOT NULL DEFAULT 25.00,
  items_per_page INT NOT NULL DEFAULT 20,
  store_active BOOLEAN NOT NULL DEFAULT true,
  allow_return_to_warehouse BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.configs (store_name) VALUES ('Minha Loja');

-- ============================================================
-- PHASE 2: CATEGORIES
-- ============================================================

CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT categories_name_unique UNIQUE (name)
);

-- ============================================================
-- PHASE 2: PRODUCTS
-- ============================================================

CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  unit TEXT NOT NULL DEFAULT 'un',
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  price_method public.price_method NOT NULL DEFAULT 'margin_percentage',
  margin_percent NUMERIC(5,2) NOT NULL DEFAULT 25.00,
  sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  location TEXT NOT NULL DEFAULT 'warehouse',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT products_code_unique UNIQUE (code),
  CONSTRAINT products_name_unique UNIQUE (name),
  CONSTRAINT products_cost_non_negative CHECK (cost_price >= 0),
  CONSTRAINT products_sale_non_negative CHECK (sale_price >= 0),
  CONSTRAINT products_margin_non_negative CHECK (margin_percent >= 0)
);

-- ============================================================
-- PHASE 2: STOCK MOVEMENTS
-- ============================================================

CREATE TABLE public.stock_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  movement_type public.movement_type NOT NULL,
  quantity NUMERIC(12,3) NOT NULL,
  unit_cost NUMERIC(12,2),
  total_cost NUMERIC(14,2),
  reference_id UUID,
  reference_type TEXT,
  location TEXT NOT NULL DEFAULT 'warehouse',
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_movements_product ON public.stock_movements(product_id);
CREATE INDEX idx_stock_movements_type ON public.stock_movements(movement_type);
CREATE INDEX idx_stock_movements_date ON public.stock_movements(created_at);
CREATE INDEX idx_stock_movements_location ON public.stock_movements(location);

-- ============================================================
-- PHASE 2: TRANSFERS
-- ============================================================

CREATE TABLE public.transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference TEXT NOT NULL,
  from_location TEXT NOT NULL DEFAULT 'warehouse',
  to_location TEXT NOT NULL DEFAULT 'store',
  status public.transfer_status NOT NULL DEFAULT 'pending',
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.transfer_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_id UUID NOT NULL REFERENCES public.transfers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transfers_status ON public.transfers(status);
CREATE INDEX idx_transfers_date ON public.transfers(created_at);

-- ============================================================
-- PHASE 2: CASH REGISTERS (before sales — sales has FK to this)
-- ============================================================

CREATE TABLE public.cash_registers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  opening_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  closing_amount NUMERIC(14,2),
  expected_amount NUMERIC(14,2),
  difference NUMERIC(14,2),
  difference_note TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

-- ============================================================
-- PHASE 2: SALES (references cash_registers)
-- ============================================================

CREATE TABLE public.sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference TEXT NOT NULL,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  cash_register_id UUID REFERENCES public.cash_registers(id),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.sale_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL,
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sales_date ON public.sales(created_at);
CREATE INDEX idx_sales_user ON public.sales(user_id);
CREATE INDEX idx_sale_items_sale ON public.sale_items(sale_id);

-- ============================================================
-- PHASE 2: CASH MOVEMENTS (after sales + cash_registers)
-- ============================================================

CREATE TABLE public.cash_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cash_register_id UUID NOT NULL REFERENCES public.cash_registers(id) ON DELETE CASCADE,
  movement_type public.cash_movement_type NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  description TEXT,
  sale_id UUID REFERENCES public.sales(id),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cash_movements_register ON public.cash_movements(cash_register_id);

-- ============================================================
-- PHASE 2: INVENTORY
-- ============================================================

CREATE TABLE public.inventories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location TEXT NOT NULL DEFAULT 'warehouse',
  status public.inventory_status NOT NULL DEFAULT 'open',
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE public.inventory_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inventory_id UUID NOT NULL REFERENCES public.inventories(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  system_quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  counted_quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  difference NUMERIC(12,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PHASE 2: LOSSES
-- ============================================================

CREATE TABLE public.losses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  location TEXT NOT NULL DEFAULT 'warehouse',
  reason TEXT,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PHASE 2: THEFTS
-- ============================================================

CREATE TABLE public.thefts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  location TEXT NOT NULL DEFAULT 'store',
  reference TEXT,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PHASE 2: FUEL RECORDS
-- ============================================================

CREATE TABLE public.fuel_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fuel_type TEXT NOT NULL,
  liters NUMERIC(10,2) NOT NULL CHECK (liters > 0),
  cost_per_liter NUMERIC(12,2) NOT NULL,
  total_cost NUMERIC(14,2) NOT NULL,
  supplier TEXT,
  vehicle TEXT,
  note TEXT,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PHASE 2: DAILY CLOSINGS
-- ============================================================

CREATE TABLE public.daily_closings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  closing_date DATE NOT NULL,
  total_sales NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_losses NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_thefts NUMERIC(14,2) NOT NULL DEFAULT 0,
  cash_expected NUMERIC(14,2) NOT NULL DEFAULT 0,
  cash_actual NUMERIC(14,2) NOT NULL DEFAULT 0,
  cash_difference NUMERIC(14,2) NOT NULL DEFAULT 0,
  cash_difference_note TEXT,
  status public.closing_status NOT NULL DEFAULT 'open',
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  CONSTRAINT daily_closings_date_unique UNIQUE (closing_date)
);

-- ============================================================
-- PHASE 2: AUDIT LOGS
-- ============================================================

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id UUID,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_date ON public.audit_logs(created_at);
CREATE INDEX idx_audit_logs_user ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_table ON public.audit_logs(table_name);

-- ============================================================
-- PHASE 2: VIEWS — Stock Balances
-- ============================================================

CREATE OR REPLACE VIEW public.v_stock_warehouse AS
SELECT
  p.id AS product_id,
  p.code,
  p.name,
  COALESCE(SUM(
    CASE
      WHEN sm.movement_type = 'entry' THEN sm.quantity
      WHEN sm.movement_type = 'transfer_in' AND sm.location = 'warehouse' THEN sm.quantity
      WHEN sm.movement_type = 'transfer_out' AND sm.location = 'warehouse' THEN -sm.quantity
      WHEN sm.movement_type = 'loss' AND sm.location = 'warehouse' THEN -sm.quantity
      WHEN sm.movement_type = 'theft' AND sm.location = 'warehouse' THEN -sm.quantity
      WHEN sm.movement_type = 'inventory_adjustment' AND sm.location = 'warehouse' THEN sm.quantity
      WHEN sm.movement_type = 'authorized_correction' AND sm.location = 'warehouse' THEN sm.quantity
      WHEN sm.movement_type = 'return' AND sm.location = 'warehouse' THEN sm.quantity
      ELSE 0
    END
  ), 0) AS quantity
FROM public.products p
LEFT JOIN public.stock_movements sm ON sm.product_id = p.id
GROUP BY p.id, p.code, p.name;

CREATE OR REPLACE VIEW public.v_stock_store AS
SELECT
  p.id AS product_id,
  p.code,
  p.name,
  COALESCE(SUM(
    CASE
      WHEN sm.movement_type = 'transfer_in' AND sm.location = 'store' THEN sm.quantity
      WHEN sm.movement_type = 'sale' AND sm.location = 'store' THEN -sm.quantity
      WHEN sm.movement_type = 'loss' AND sm.location = 'store' THEN -sm.quantity
      WHEN sm.movement_type = 'theft' AND sm.location = 'store' THEN -sm.quantity
      WHEN sm.movement_type = 'inventory_adjustment' AND sm.location = 'store' THEN sm.quantity
      WHEN sm.movement_type = 'authorized_correction' AND sm.location = 'store' THEN sm.quantity
      WHEN sm.movement_type = 'return' AND sm.location = 'store' THEN sm.quantity
      ELSE 0
    END
  ), 0) AS quantity
FROM public.products p
LEFT JOIN public.stock_movements sm ON sm.product_id = p.id
GROUP BY p.id, p.code, p.name;

-- ============================================================
-- PHASE 2: FUNCTIONS
-- ============================================================

-- get_stock_balance
CREATE OR REPLACE FUNCTION public.get_stock_balance(
  p_product_id UUID,
  p_location TEXT
)
RETURNS NUMERIC AS $$
DECLARE
  balance NUMERIC;
BEGIN
  SELECT COALESCE(SUM(
    CASE
      WHEN sm.movement_type = 'entry' AND sm.location = p_location THEN sm.quantity
      WHEN sm.movement_type = 'transfer_in' AND sm.location = p_location THEN sm.quantity
      WHEN sm.movement_type = 'transfer_out' AND sm.location = p_location THEN -sm.quantity
      WHEN sm.movement_type = 'sale' AND sm.location = p_location THEN -sm.quantity
      WHEN sm.movement_type = 'return' AND sm.location = p_location THEN sm.quantity
      WHEN sm.movement_type = 'loss' AND sm.location = p_location THEN -sm.quantity
      WHEN sm.movement_type = 'theft' AND sm.location = p_location THEN -sm.quantity
      WHEN sm.movement_type IN ('inventory_adjustment','authorized_correction') AND sm.location = p_location THEN sm.quantity
      ELSE 0
    END
  ), 0)
  INTO balance
  FROM public.stock_movements sm
  WHERE sm.product_id = p_product_id;
  RETURN balance;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- process_sale
CREATE OR REPLACE FUNCTION public.process_sale(
  p_user_id UUID,
  p_cash_register_id UUID,
  p_payment_method TEXT,
  p_discount NUMERIC,
  p_items JSONB
)
RETURNS UUID AS $$
DECLARE
  v_sale_id UUID;
  v_reference TEXT;
  v_total NUMERIC := 0;
  v_cost_total NUMERIC := 0;
  v_item JSONB;
  v_product_id UUID;
  v_quantity NUMERIC;
  v_unit_price NUMERIC;
  v_unit_cost NUMERIC;
  v_product_name TEXT;
  v_stock_balance NUMERIC;
  v_item_total NUMERIC;
  v_item_cost_total NUMERIC;
BEGIN
  v_reference := 'VND-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('sale_ref_seq')::text, 5, '0');
  INSERT INTO public.sales (reference, user_id, cash_register_id, payment_method, discount, total, cost_total)
  VALUES (v_reference, p_user_id, p_cash_register_id, p_payment_method, p_discount, 0, 0)
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_quantity := (v_item->>'quantity')::NUMERIC;
    v_unit_price := (v_item->>'unit_price')::NUMERIC;
    SELECT name, cost_price INTO v_product_name, v_unit_cost FROM public.products WHERE id = v_product_id;
    SELECT public.get_stock_balance(v_product_id, 'store') INTO v_stock_balance;
    IF v_stock_balance < v_quantity THEN
      RAISE EXCEPTION 'Estoque insuficiente para %: disponível %, solicitado %', v_product_name, v_stock_balance, v_quantity;
    END IF;
    v_item_total := v_quantity * v_unit_price;
    v_item_cost_total := v_quantity * v_unit_cost;
    INSERT INTO public.sale_items (sale_id, product_id, product_name, quantity, unit_price, unit_cost, total)
    VALUES (v_sale_id, v_product_id, v_product_name, v_quantity, v_unit_price, v_unit_cost, v_item_total);
    INSERT INTO public.stock_movements (product_id, movement_type, quantity, unit_cost, total_cost, reference_id, reference_type, location, user_id)
    VALUES (v_product_id, 'sale', v_quantity, v_unit_cost, v_item_cost_total, v_sale_id, 'sale', 'store', p_user_id);
    v_total := v_total + v_item_total;
    v_cost_total := v_cost_total + v_item_cost_total;
  END LOOP;

  UPDATE public.sales SET total = v_total - p_discount, cost_total = v_cost_total WHERE id = v_sale_id;
  INSERT INTO public.cash_movements (cash_register_id, movement_type, amount, description, sale_id, user_id)
  VALUES (p_cash_register_id, 'sale', v_total - p_discount, 'Venda ' || v_reference, v_sale_id, p_user_id);
  RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql;

-- process_transfer
CREATE OR REPLACE FUNCTION public.process_transfer(
  p_user_id UUID,
  p_from_location TEXT,
  p_to_location TEXT,
  p_items JSONB,
  p_note TEXT
)
RETURNS UUID AS $$
DECLARE
  v_transfer_id UUID;
  v_reference TEXT;
  v_item JSONB;
  v_product_id UUID;
  v_quantity NUMERIC;
  v_stock_balance NUMERIC;
  v_product_name TEXT;
BEGIN
  v_reference := 'TRF-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('transfer_ref_seq')::text, 5, '0');
  INSERT INTO public.transfers (reference, from_location, to_location, status, user_id, note)
  VALUES (v_reference, p_from_location, p_to_location, 'completed', p_user_id, p_note)
  RETURNING id INTO v_transfer_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_quantity := (v_item->>'quantity')::NUMERIC;
    SELECT name INTO v_product_name FROM public.products WHERE id = v_product_id;
    SELECT public.get_stock_balance(v_product_id, p_from_location) INTO v_stock_balance;
    IF v_stock_balance < v_quantity THEN
      RAISE EXCEPTION 'Estoque insuficiente no % para %: disponível %, solicitado %', p_from_location, v_product_name, v_stock_balance, v_quantity;
    END IF;
    INSERT INTO public.transfer_items (transfer_id, product_id, quantity) VALUES (v_transfer_id, v_product_id, v_quantity);
    INSERT INTO public.stock_movements (product_id, movement_type, quantity, reference_id, reference_type, location, user_id, note)
    VALUES (v_product_id, 'transfer_out', v_quantity, v_transfer_id, 'transfer', p_from_location, p_user_id, 'Transferência ' || v_reference || ' de ' || p_from_location);
    INSERT INTO public.stock_movements (product_id, movement_type, quantity, reference_id, reference_type, location, user_id, note)
    VALUES (v_product_id, 'transfer_in', v_quantity, v_transfer_id, 'transfer', p_to_location, p_user_id, 'Transferência ' || v_reference || ' para ' || p_to_location);
  END LOOP;
  RETURN v_transfer_id;
END;
$$ LANGUAGE plpgsql;

-- update_updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Sequences
CREATE SEQUENCE IF NOT EXISTS public.sale_ref_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.transfer_ref_seq START 1;

-- Triggers
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER configs_updated_at BEFORE UPDATE ON public.configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER categories_updated_at BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER transfers_updated_at BEFORE UPDATE ON public.transfers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- PHASE 3: ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.losses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thefts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_closings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Helper functions
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.app_role AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT public.current_user_role() = 'admin';
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_junior_admin()
RETURNS BOOLEAN AS $$
  SELECT public.current_user_role() IN ('admin', 'junior_admin');
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ============================================================
-- RLS: PROFILES
-- ============================================================

CREATE POLICY "profiles_read_own" ON public.profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "profiles_read_all_admin" ON public.profiles
  FOR SELECT USING (public.is_admin());

CREATE POLICY "profiles_read_all_junior" ON public.profiles
  FOR SELECT USING (public.current_user_role() = 'junior_admin');

CREATE POLICY "profiles_insert_admin" ON public.profiles
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "profiles_update_admin" ON public.profiles
  FOR UPDATE USING (public.is_admin());

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_delete_admin" ON public.profiles
  FOR DELETE USING (public.is_admin());

-- ============================================================
-- RLS: CONFIGS
-- ============================================================

CREATE POLICY "configs_read_all" ON public.configs
  FOR SELECT USING (true);

CREATE POLICY "configs_insert_admin" ON public.configs
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "configs_update_admin" ON public.configs
  FOR UPDATE USING (public.is_admin());

CREATE POLICY "configs_delete_admin" ON public.configs
  FOR DELETE USING (public.is_admin());

-- ============================================================
-- RLS: CATEGORIES
-- ============================================================

CREATE POLICY "categories_read_all" ON public.categories
  FOR SELECT USING (true);

CREATE POLICY "categories_insert_admin" ON public.categories
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "categories_update_admin" ON public.categories
  FOR UPDATE USING (public.is_admin());

CREATE POLICY "categories_delete_admin" ON public.categories
  FOR DELETE USING (public.is_admin());

-- ============================================================
-- RLS: PRODUCTS
-- ============================================================

CREATE POLICY "products_read_all" ON public.products
  FOR SELECT USING (true);

CREATE POLICY "products_insert_admin" ON public.products
  FOR INSERT WITH CHECK (public.is_junior_admin());

CREATE POLICY "products_update_admin" ON public.products
  FOR UPDATE USING (public.is_junior_admin());

CREATE POLICY "products_delete_admin" ON public.products
  FOR DELETE USING (public.is_admin());

-- ============================================================
-- RLS: STOCK MOVEMENTS
-- ============================================================

CREATE POLICY "stock_movements_read_admin" ON public.stock_movements
  FOR SELECT USING (public.is_junior_admin());

CREATE POLICY "stock_movements_read_cashier" ON public.stock_movements
  FOR SELECT USING (
    public.current_user_role() = 'cashier'
    AND movement_type = 'sale'
    AND user_id = auth.uid()
  );

CREATE POLICY "stock_movements_read_cashier_store" ON public.stock_movements
  FOR SELECT USING (
    public.current_user_role() = 'cashier'
    AND location = 'store'
  );

CREATE POLICY "stock_movements_insert_admin" ON public.stock_movements
  FOR INSERT WITH CHECK (public.is_junior_admin());

CREATE POLICY "stock_movements_insert_sale_cashier" ON public.stock_movements
  FOR INSERT WITH CHECK (
    public.current_user_role() = 'cashier'
    AND movement_type = 'sale'
    AND user_id = auth.uid()
  );

CREATE POLICY "stock_movements_update_admin" ON public.stock_movements
  FOR UPDATE USING (public.is_admin());

CREATE POLICY "stock_movements_delete_admin" ON public.stock_movements
  FOR DELETE USING (public.is_admin());

-- ============================================================
-- RLS: TRANSFERS
-- ============================================================

CREATE POLICY "transfers_read_admin" ON public.transfers
  FOR SELECT USING (public.is_junior_admin());

CREATE POLICY "transfers_insert_admin" ON public.transfers
  FOR INSERT WITH CHECK (public.is_junior_admin());

CREATE POLICY "transfers_update_admin" ON public.transfers
  FOR UPDATE USING (public.is_admin());

CREATE POLICY "transfers_delete_admin" ON public.transfers
  FOR DELETE USING (public.is_admin());

CREATE POLICY "transfer_items_read_admin" ON public.transfer_items
  FOR SELECT USING (public.is_junior_admin());

CREATE POLICY "transfer_items_insert_admin" ON public.transfer_items
  FOR INSERT WITH CHECK (public.is_junior_admin());

-- ============================================================
-- RLS: SALES
-- ============================================================

CREATE POLICY "sales_read_all_admin" ON public.sales
  FOR SELECT USING (public.is_junior_admin());

CREATE POLICY "sales_read_own_cashier" ON public.sales
  FOR SELECT USING (
    public.current_user_role() = 'cashier'
    AND user_id = auth.uid()
  );

CREATE POLICY "sales_insert_all" ON public.sales
  FOR INSERT WITH CHECK (true);

CREATE POLICY "sales_update_admin" ON public.sales
  FOR UPDATE USING (public.is_admin());

CREATE POLICY "sales_delete_admin" ON public.sales
  FOR DELETE USING (public.is_admin());

CREATE POLICY "sale_items_read_admin" ON public.sale_items
  FOR SELECT USING (public.is_junior_admin());

CREATE POLICY "sale_items_read_cashier" ON public.sale_items
  FOR SELECT USING (
    public.current_user_role() = 'cashier'
    AND EXISTS (
      SELECT 1 FROM public.sales s WHERE s.id = sale_items.sale_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "sale_items_insert_all" ON public.sale_items
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- RLS: CASH REGISTERS
-- ============================================================

CREATE POLICY "cash_registers_read_admin" ON public.cash_registers
  FOR SELECT USING (public.is_junior_admin());

CREATE POLICY "cash_registers_read_cashier" ON public.cash_registers
  FOR SELECT USING (
    public.current_user_role() = 'cashier'
    AND user_id = auth.uid()
  );

CREATE POLICY "cash_registers_insert_all" ON public.cash_registers
  FOR INSERT WITH CHECK (true);

CREATE POLICY "cash_registers_update_all" ON public.cash_registers
  FOR UPDATE USING (true);

-- ============================================================
-- RLS: CASH MOVEMENTS
-- ============================================================

CREATE POLICY "cash_movements_read_admin" ON public.cash_movements
  FOR SELECT USING (public.is_junior_admin());

CREATE POLICY "cash_movements_read_cashier" ON public.cash_movements
  FOR SELECT USING (
    public.current_user_role() = 'cashier'
    AND cash_register_id IN (
      SELECT id FROM public.cash_registers WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "cash_movements_insert_all" ON public.cash_movements
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- RLS: INVENTORIES
-- ============================================================

CREATE POLICY "inventories_read_admin" ON public.inventories
  FOR SELECT USING (public.is_junior_admin());

CREATE POLICY "inventories_insert_admin" ON public.inventories
  FOR INSERT WITH CHECK (public.is_junior_admin());

CREATE POLICY "inventories_update_admin" ON public.inventories
  FOR UPDATE USING (public.is_admin());

CREATE POLICY "inventory_items_read_admin" ON public.inventory_items
  FOR SELECT USING (public.is_junior_admin());

CREATE POLICY "inventory_items_insert_admin" ON public.inventory_items
  FOR INSERT WITH CHECK (public.is_junior_admin());

-- ============================================================
-- RLS: LOSSES
-- ============================================================

CREATE POLICY "losses_read_admin" ON public.losses
  FOR SELECT USING (public.is_junior_admin());

CREATE POLICY "losses_insert_admin" ON public.losses
  FOR INSERT WITH CHECK (public.is_junior_admin());

CREATE POLICY "losses_delete_admin" ON public.losses
  FOR DELETE USING (public.is_admin());

-- ============================================================
-- RLS: THEFTS
-- ============================================================

CREATE POLICY "thefts_read_admin" ON public.thefts
  FOR SELECT USING (public.is_junior_admin());

CREATE POLICY "thefts_insert_admin" ON public.thefts
  FOR INSERT WITH CHECK (public.is_junior_admin());

CREATE POLICY "thefts_delete_admin" ON public.thefts
  FOR DELETE USING (public.is_admin());

-- ============================================================
-- RLS: FUEL RECORDS
-- ============================================================

CREATE POLICY "fuel_records_read_admin" ON public.fuel_records
  FOR SELECT USING (public.is_junior_admin());

CREATE POLICY "fuel_records_insert_admin" ON public.fuel_records
  FOR INSERT WITH CHECK (public.is_junior_admin());

CREATE POLICY "fuel_records_update_admin" ON public.fuel_records
  FOR UPDATE USING (public.is_admin());

CREATE POLICY "fuel_records_delete_admin" ON public.fuel_records
  FOR DELETE USING (public.is_admin());

-- ============================================================
-- RLS: DAILY CLOSINGS
-- ============================================================

CREATE POLICY "daily_closings_read_admin" ON public.daily_closings
  FOR SELECT USING (public.is_junior_admin());

CREATE POLICY "daily_closings_insert_admin" ON public.daily_closings
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "daily_closings_update_admin" ON public.daily_closings
  FOR UPDATE USING (public.is_admin());

-- ============================================================
-- RLS: AUDIT LOGS
-- ============================================================

CREATE POLICY "audit_logs_read_admin" ON public.audit_logs
  FOR SELECT USING (public.is_admin());

CREATE POLICY "audit_logs_insert_system" ON public.audit_logs
  FOR INSERT WITH CHECK (public.is_admin());

-- ============================================================
-- PHASE 6: SEED — Pre-defined user profiles
-- These INSERTs assign roles to specific auth.users IDs.
-- Run AFTER the users have signed up in Supabase Auth.
-- ============================================================

-- Admin profile (role = admin)
INSERT INTO public.profiles (id, full_name, role, active)
VALUES (
  '1c8ade62-0068-46f0-862d-6735a5201445',
  'Administrador',
  'admin',
  true
)
ON CONFLICT (id) DO UPDATE SET
  role = EXCLUDED.role,
  full_name = EXCLUDED.full_name,
  active = EXCLUDED.active;

-- Cashier profile (role = cashier)
INSERT INTO public.profiles (id, full_name, role, active)
VALUES (
  '5e608e80-e5fa-41c7-9152-644adb779fea',
  'Caixa',
  'cashier',
  true
)
ON CONFLICT (id) DO UPDATE SET
  role = EXCLUDED.role,
  full_name = EXCLUDED.full_name,
  active = EXCLUDED.active;

-- ============================================================
-- DONE! OSA database is fully configured.
-- Next: fill SUPABASE_URL + SUPABASE_ANON_KEY in js/config.js
-- Then deploy the osa/ folder to GitHub Pages
-- ============================================================