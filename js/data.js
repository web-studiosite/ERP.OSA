/**
 * OSA — Data Layer
 * Centralized CRUD operations against Supabase
 * ZERO FALSE SUCCESS — every operation must be confirmed by PostgreSQL
 */

const OSA_DATA = (() => {

  // --- Helper: build query ---

  function _buildQuery(sb, table, options = {}) {
    let query = sb.from(table);
    return query;
  }

  // --- CREATE ---

  async function create(table, record) {
    const sb = getSupabase();
    if (!sb) return { ok: false, error: 'Supabase não configurado' };

    try {
      const { data, error, status } = await sb
        .from(table)
        .insert(record)
        .select()
        .single();

      if (error) {
        return {
          ok: false,
          error: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
          status
        };
      }

      // CONFIRMATION: record must be returned with valid ID
      if (!data) {
        return { ok: false, error: 'INSERT aceito mas nenhum registro retornado pelo Supabase', status };
      }

      if (!data.id && data.id !== 0) {
        return { ok: false, error: 'Registro criado sem ID válido', status };
      }

      return { ok: true, data, status };
    } catch (err) {
      return { ok: false, error: err.message, status: 0 };
    }
  }

  // --- READ ---

  async function read(table, options = {}) {
    const sb = getSupabase();
    if (!sb) return { ok: false, error: 'Supabase não configurado' };

    try {
      let query = sb.from(table).select(options.select || '*');

      // Filters
      if (options.filters) {
        for (const f of options.filters) {
          if (f.operator === 'eq') query = query.eq(f.column, f.value);
          else if (f.operator === 'neq') query = query.neq(f.column, f.value);
          else if (f.operator === 'gt') query = query.gt(f.column, f.value);
          else if (f.operator === 'gte') query = query.gte(f.column, f.value);
          else if (f.operator === 'lt') query = query.lt(f.column, f.value);
          else if (f.operator === 'lte') query = query.lte(f.column, f.value);
          else if (f.operator === 'like') query = query.like(f.column, f.value);
          else if (f.operator === 'ilike') query = query.ilike(f.column, f.value);
          else if (f.operator === 'in') query = query.in(f.column, f.value);
          else if (f.operator === 'is') query = query.is(f.column, f.value);
          else if (f.operator === 'contains') query = query.contains(f.column, f.value);
          else query = query.eq(f.column, f.value);
        }
      }

      // Single filter shorthand
      if (options.filter) {
        query = query.eq(options.filter.column, options.filter.value);
      }

      // Date range filter
      if (options.dateRange) {
        if (options.dateRange.from) query = query.gte(options.dateRange.column || 'created_at', options.dateRange.from);
        if (options.dateRange.to) query = query.lte(options.dateRange.column || 'created_at', options.dateRange.to);
      }

      // Ordering
      if (options.order) {
        query = query.order(options.order.column, { ascending: options.order.ascending !== false });
      } else {
        query = query.order('created_at', { ascending: false });
      }

      // Pagination
      if (options.limit) query = query.limit(options.limit);
      if (options.offset) query = query.range(options.offset, options.offset + (options.limit || 20) - 1);

      // Single record
      if (options.single) {
        const { data, error, status } = await query.single();
        if (error) {
          if (error.code === 'PGRST116') {
            return { ok: false, error: 'Registro não encontrado', status, notFound: true };
          }
          return { ok: false, error: error.message, code: error.code, details: error.details, status };
        }
        return { ok: true, data, status };
      }

      const { data, error, status, count } = await query;

      if (error) {
        return { ok: false, error: error.message, code: error.code, details: error.details, status };
      }

      return { ok: true, data: data || [], count, status };
    } catch (err) {
      return { ok: false, error: err.message, status: 0 };
    }
  }

  // --- COUNT ---

  async function count(table, options = {}) {
    const sb = getSupabase();
    if (!sb) return { ok: false, error: 'Supabase não configurado' };

    try {
      let query = sb.from(table).select('*', { count: 'exact', head: true });

      if (options.filters) {
        for (const f of options.filters) {
          if (f.operator === 'eq') query = query.eq(f.column, f.value);
          else if (f.operator === 'neq') query = query.neq(f.column, f.value);
          else if (f.operator === 'gte') query = query.gte(f.column, f.value);
          else if (f.operator === 'lte') query = query.lte(f.column, f.value);
          else query = query.eq(f.column, f.value);
        }
      }

      if (options.filter) {
        query = query.eq(options.filter.column, options.filter.value);
      }

      const { count: c, error, status } = await query;

      if (error) {
        return { ok: false, error: error.message, code: error.code, status };
      }

      return { ok: true, count: c, status };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // --- UPDATE ---

  async function update(table, id, updates) {
    const sb = getSupabase();
    if (!sb) return { ok: false, error: 'Supabase não configurado' };

    try {
      const { data, error, status } = await sb
        .from(table)
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        return {
          ok: false,
          error: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
          status
        };
      }

      // CONFIRMATION: updated record must be returned with matching ID
      if (!data) {
        return { ok: false, error: 'UPDATE aceito mas nenhum registro retornado — registro pode não existir', status };
      }

      if (data.id !== id) {
        return { ok: false, error: 'ID do registro retornado não corresponde ao solicitado', status };
      }

      return { ok: true, data, status };
    } catch (err) {
      return { ok: false, error: err.message, status: 0 };
    }
  }

  // --- DELETE ---

  async function remove(table, id, opts = {}) {
    const sb = getSupabase();
    if (!sb) return { ok: false, error: 'Supabase não configurado' };

    try {
      // Step 1: Execute delete
      const { data, error, status } = await sb
        .from(table)
        .delete()
        .eq('id', id)
        .select()
        .single();

      if (error) {
        return { ok: false, error: error.message, code: error.code, details: error.details, status };
      }

      // Step 2: Confirm record was returned (actually deleted)
      if (!data) {
        return { ok: false, error: 'DELETE executado mas nenhum registro retornado — registro pode não existir', status };
      }

      // Step 3: Verify absence (for critical tables)
      if (opts?.verify !== false) {
        const verify = await sb.from(table).select('id').eq('id', id).single();
        if (verify.data) {
          return { ok: false, error: 'Registro ainda existe após DELETE — operação não confirmada', status };
        }
      }

      return { ok: true, data, status };
    } catch (err) {
      return { ok: false, error: err.message, status: 0 };
    }
  }

  // --- RPC ---

  async function rpc(functionName, params) {
    const sb = getSupabase();
    if (!sb) return { ok: false, error: 'Supabase não configurado' };

    try {
      const { data, error, status } = await sb.rpc(functionName, params);

      if (error) {
        return { ok: false, error: error.message, code: error.code, details: error.details, status };
      }

      return { ok: true, data, status };
    } catch (err) {
      return { ok: false, error: err.message, status: 0 };
    }
  }

  // --- STOCK BALANCE (derived from movements) ---

  async function getStockBalance(productId, location) {
    return rpc('get_stock_balance', { p_product_id: productId, p_location: location });
  }

  // --- AUDIT LOG ---

  async function audit(action, tableName, recordId, oldData, newData) {
    const userId = OSA_AUTH.getCurrentUser()?.id;
    if (!userId) return { ok: false, error: 'Sem utilizador autenticado' };

    return create('audit_logs', {
      user_id: userId,
      action,
      table_name: tableName,
      record_id: recordId,
      old_data: oldData || null,
      new_data: newData || null
    });
  }

  return {
    create,
    read,
    count,
    update,
    remove,
    rpc,
    getStockBalance,
    audit
  };
})();
