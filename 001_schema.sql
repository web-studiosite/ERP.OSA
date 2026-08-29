-- ============================================================
-- OSA — Official Shop Administrator
-- Database Schema for Single Store ERP
-- PostgreSQL / Supabase
-- CORRECTED: table order respects FK dependencies
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- CLEANUP: Drop everything if re-running (safe idempotent reset)
-- Drop in reverse dependency order (children first, parents last)
-- ============================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS public.process_sale();
DROP FUNCTION IF EXISTS public.process_transfer();
DROP FUNCTION IF EXISTS public.get_stock_balance(UUID, TEXT);
DROP FUNCTION IF EXISTS public.current_user_role();
DROP FUNCTION IF EXISTS public.is_admin();
DROP FUNCTION IF EXISTS public.is_junior_admin();
DROP FUNCTION IF EXISTS public.update_updated_at();
DROP VIEW IF EXISTS public.v_stock_warehouse;
DROP VIEW IF EXISTS public.v_stock_store;
DROP SEQUENCE IF EXISTS public.sale_ref_seq;
DROP SEQUENCE IF EXISTS public.transfer_ref_seq;
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
DROP TYPE IF EXISTS public.app_role;
DROP TYPE IF EXISTS public.movement_type;
DROP TYPE IF EXISTS public.transfer_status;
DROP TYPE IF EXISTS public.cash_movement_type;
DROP TYPE IF EXISTS public.inventory_status;
DROP TYPE IF EXISTS public.closing_status;
DROP TYPE IF EXISTS public.price_method;

-- ============================================================
-- CUSTOM TYPES
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
-- PROFILES (public user data — auth.users is the auth source)
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

-- Auto-create profile on signup
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
-- CONFIGS (single store configuration)
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

-- Insert default config
INSERT INTO public.configs (store_name) VALUES ('Minha Loja');

-- ============================================================
-- CATEGORIES
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
-- PRODUCTS
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
  location TEXT NOT NULL DEFAULT 'warehouse', -- warehouse | store
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
-- STOCK MOVEMENTS (source of truth for inventory)
-- ============================================================

CREATE TABLE public.stock_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  movement_type public.movement_type NOT NULL,
  quantity NUMERIC(12,3) NOT NULL,
  unit_cost NUMERIC(12,2),
  total_cost NUMERIC(14,2),
  reference_id UUID, -- links to sale, transfer, loss, theft, inventory
  reference_type TEXT, -- 'sale', 'transfer', 'loss', 'theft', 'inventory', 'return'
  location TEXT NOT NULL DEFAULT 'warehouse', -- where the movement applies
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_movements_product ON public.stock_movements(product_id);
CREATE INDEX idx_stock_movements_type ON public.stock_movements(movement_type);
CREATE INDEX idx_stock_movements_date ON public.stock_movements(created_at);
CREATE INDEX idx_stock_movements_location ON public.stock_movements(location);

-- ============================================================
-- TRANSFERS
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
-- CASH REGISTERS  ← MUST COME BEFORE SALES (sales has FK to this)
-- ============================================================

CREATE TABLE public.cash_registers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  opening_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  closing_amount NUMERIC(14,2),
  expected_amount NUMERIC(14,2),
  difference NUMERIC(14,2),
  difference_note TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open | closed
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

-- ============================================================
-- SALES  ← References cash_registers (must come after it)
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
-- CASH MOVEMENTS  ← References cash_registers + sales (must come after both)
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
-- INVENTORY
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
-- LOSSES
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
-- THEFTS
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
-- FUEL RECORDS
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
-- DAILY CLOSINGS
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
-- AUDIT LOGS
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
-- VIEWS — Derived stock balances
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
-- FUNCTION: get_stock_balance(product_id, location)
-- ============================================================

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

-- ============================================================
-- SEQUENCES for references
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS public.sale_ref_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.transfer_ref_seq START 1;

-- ============================================================
-- FUNCTION: process_sale (transactional)
-- ============================================================

CREATE OR REPLACE FUNCTION public.process_sale(
  p_user_id UUID,
  p_cash_register_id UUID,
  p_payment_method TEXT,
  p_discount NUMERIC,
  p_items JSONB -- [{product_id, quantity, unit_price}]
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
  -- Generate reference
  v_reference := 'VND-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('sale_ref_seq')::text, 5, '0');

  -- Create sale
  INSERT INTO public.sales (reference, user_id, cash_register_id, payment_method, discount, total, cost_total)
  VALUES (v_reference, p_user_id, p_cash_register_id, p_payment_method, p_discount, 0, 0)
  RETURNING id INTO v_sale_id;

  -- Process each item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_quantity := (v_item->>'quantity')::NUMERIC;
    v_unit_price := (v_item->>'unit_price')::NUMERIC;

    -- Get product info
    SELECT name, cost_price INTO v_product_name, v_unit_cost
    FROM public.products WHERE id = v_product_id;

    -- Validate stock
    SELECT public.get_stock_balance(v_product_id, 'store') INTO v_stock_balance;
    IF v_stock_balance < v_quantity THEN
      RAISE EXCEPTION 'Estoque insuficiente para %: disponível %, solicitado %',
        v_product_name, v_stock_balance, v_quantity;
    END IF;

    v_item_total := v_quantity * v_unit_price;
    v_item_cost_total := v_quantity * v_unit_cost;

    -- Insert sale item
    INSERT INTO public.sale_items (sale_id, product_id, product_name, quantity, unit_price, unit_cost, total)
    VALUES (v_sale_id, v_product_id, v_product_name, v_quantity, v_unit_price, v_unit_cost, v_item_total);

    -- Insert stock movement (sale)
    INSERT INTO public.stock_movements (product_id, movement_type, quantity, unit_cost, total_cost, reference_id, reference_type, location, user_id)
    VALUES (v_product_id, 'sale', v_quantity, v_unit_cost, v_item_cost_total, v_sale_id, 'sale', 'store', p_user_id);

    v_total := v_total + v_item_total;
    v_cost_total := v_cost_total + v_item_cost_total;
  END LOOP;

  -- Apply discount and update sale
  UPDATE public.sales
  SET total = v_total - p_discount,
      cost_total = v_cost_total
  WHERE id = v_sale_id;

  -- Insert cash movement
  INSERT INTO public.cash_movements (cash_register_id, movement_type, amount, description, sale_id, user_id)
  VALUES (p_cash_register_id, 'sale', v_total - p_discount,
    'Venda ' || v_reference, v_sale_id, p_user_id);

  RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCTION: process_transfer (transactional)
-- ============================================================

CREATE OR REPLACE FUNCTION public.process_transfer(
  p_user_id UUID,
  p_from_location TEXT,
  p_to_location TEXT,
  p_items JSONB, -- [{product_id, quantity}]
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
  -- Generate reference
  v_reference := 'TRF-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('transfer_ref_seq')::text, 5, '0');

  -- Create transfer
  INSERT INTO public.transfers (reference, from_location, to_location, status, user_id, note)
  VALUES (v_reference, p_from_location, p_to_location, 'completed', p_user_id, p_note)
  RETURNING id INTO v_transfer_id;

  -- Process each item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_quantity := (v_item->>'quantity')::NUMERIC;

    -- Get product name
    SELECT name INTO v_product_name FROM public.products WHERE id = v_product_id;

    -- Validate source stock
    SELECT public.get_stock_balance(v_product_id, p_from_location) INTO v_stock_balance;
    IF v_stock_balance < v_quantity THEN
      RAISE EXCEPTION 'Estoque insuficiente no % para %: disponível %, solicitado %',
        p_from_location, v_product_name, v_stock_balance, v_quantity;
    END IF;

    -- Insert transfer item
    INSERT INTO public.transfer_items (transfer_id, product_id, quantity)
    VALUES (v_transfer_id, v_product_id, v_quantity);

    -- Stock movement OUT from source
    INSERT INTO public.stock_movements (product_id, movement_type, quantity, reference_id, reference_type, location, user_id, note)
    VALUES (v_product_id, 'transfer_out', v_quantity, v_transfer_id, 'transfer', p_from_location, p_user_id,
      'Transferência ' || v_reference || ' de ' || p_from_location);

    -- Stock movement IN to destination
    INSERT INTO public.stock_movements (product_id, movement_type, quantity, reference_id, reference_type, location, user_id, note)
    VALUES (v_product_id, 'transfer_in', v_quantity, v_transfer_id, 'transfer', p_to_location, p_user_id,
      'Transferência ' || v_reference || ' para ' || p_to_location);
  END LOOP;

  RETURN v_transfer_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TRIGGER: auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
