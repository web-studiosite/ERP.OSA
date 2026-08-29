-- ============================================================
-- OSA — RLS Policies
-- Run AFTER 001_schema.sql
-- Idempotent: drops existing policies before recreating
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

-- ============================================================
-- Drop ALL existing policies (idempotent re-run safe)
-- ============================================================

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

-- Drop and recreate helper functions (may conflict if they exist with different signatures)
DROP FUNCTION IF EXISTS public.current_user_role();
DROP FUNCTION IF EXISTS public.is_admin();
DROP FUNCTION IF EXISTS public.is_junior_admin();

-- ============================================================
-- Helper function to get current user role
-- ============================================================

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
-- PROFILES policies
-- ============================================================

-- Everyone can read their own profile
CREATE POLICY "profiles_read_own" ON public.profiles
  FOR SELECT USING (id = auth.uid());

-- Admin can read all profiles
CREATE POLICY "profiles_read_all_admin" ON public.profiles
  FOR SELECT USING (public.is_admin());

-- Junior admin can read all profiles
CREATE POLICY "profiles_read_all_junior" ON public.profiles
  FOR SELECT USING (public.current_user_role() = 'junior_admin');

-- Admin can insert profiles
CREATE POLICY "profiles_insert_admin" ON public.profiles
  FOR INSERT WITH CHECK (public.is_admin());

-- Admin can update profiles
CREATE POLICY "profiles_update_admin" ON public.profiles
  FOR UPDATE USING (public.is_admin());

-- Users can update their own name/phone
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Admin can delete profiles
CREATE POLICY "profiles_delete_admin" ON public.profiles
  FOR DELETE USING (public.is_admin());

-- ============================================================
-- CONFIGS policies
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
-- CATEGORIES policies
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
-- PRODUCTS policies
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
-- STOCK MOVEMENTS policies
-- ============================================================

-- Admin and junior_admin: full access
CREATE POLICY "stock_movements_read_admin" ON public.stock_movements
  FOR SELECT USING (public.is_junior_admin());

-- Cashier can read movements related to their own sales
CREATE POLICY "stock_movements_read_cashier" ON public.stock_movements
  FOR SELECT USING (
    public.current_user_role() = 'cashier'
    AND movement_type = 'sale'
    AND user_id = auth.uid()
  );

CREATE POLICY "stock_movements_insert_admin" ON public.stock_movements
  FOR INSERT WITH CHECK (public.is_junior_admin());

-- Cashier can insert sale movements
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
-- TRANSFERS policies
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
-- SALES policies
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

-- Sale items
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
-- CASH REGISTERS policies
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

-- Cash movements
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
-- INVENTORIES policies
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
-- LOSSES policies
-- ============================================================

CREATE POLICY "losses_read_admin" ON public.losses
  FOR SELECT USING (public.is_junior_admin());

CREATE POLICY "losses_insert_admin" ON public.losses
  FOR INSERT WITH CHECK (public.is_junior_admin());

CREATE POLICY "losses_delete_admin" ON public.losses
  FOR DELETE USING (public.is_admin());

-- ============================================================
-- THEFTS policies
-- ============================================================

CREATE POLICY "thefts_read_admin" ON public.thefts
  FOR SELECT USING (public.is_junior_admin());

CREATE POLICY "thefts_insert_admin" ON public.thefts
  FOR INSERT WITH CHECK (public.is_junior_admin());

CREATE POLICY "thefts_delete_admin" ON public.thefts
  FOR DELETE USING (public.is_admin());

-- ============================================================
-- FUEL RECORDS policies
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
-- DAILY CLOSINGS policies
-- ============================================================

CREATE POLICY "daily_closings_read_admin" ON public.daily_closings
  FOR SELECT USING (public.is_junior_admin());

CREATE POLICY "daily_closings_insert_admin" ON public.daily_closings
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "daily_closings_update_admin" ON public.daily_closings
  FOR UPDATE USING (public.is_admin());

-- ============================================================
-- AUDIT LOGS policies
-- ============================================================

CREATE POLICY "audit_logs_read_admin" ON public.audit_logs
  FOR SELECT USING (public.is_admin());

CREATE POLICY "audit_logs_insert_system" ON public.audit_logs
  FOR INSERT WITH CHECK (public.is_admin());

-- ============================================================
-- Cashier can read stock_movements for store balance (view support)
-- ============================================================

CREATE POLICY "stock_movements_read_cashier_store" ON public.stock_movements
  FOR SELECT USING (
    public.current_user_role() = 'cashier'
    AND location = 'store'
  );
