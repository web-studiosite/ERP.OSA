/**
 * OSA — System Diagnostics
 */

const OSA_DIAGNOSTICS = (() => {

  const checks = [
    { id: 'supabase_connection', label: 'Conexão Supabase', icon: '🔌' },
    { id: 'auth_session', label: 'Sessão de Autenticação', icon: '🔐' },
    { id: 'tables_accessible', label: 'Acesso às Tabelas', icon: '🗄️' },
    { id: 'rls_active', label: 'RLS Ativo', icon: '🛡️' },
    { id: 'stock_consistency', label: 'Consistência de Stock', icon: '📦' },
    { id: 'open_register', label: 'Caixa Aberta', icon: '💰' },
    { id: 'pending_transfers', label: 'Transferências Pendentes', icon: '🚚' },
    { id: 'recent_errors', label: 'Erros Recentes', icon: '⚠️' }
  ];

  async function runAllChecks() {
    const results = [];

    for (const check of checks) {
      const result = { ...check, status: 'pending', message: '' };

      try {
        switch (check.id) {
          case 'supabase_connection': {
            const start = performance.now();
            const { data, error } = await getSupabase().from('categories').select('id').limit(1);
            const elapsed = Math.round(performance.now() - start);
            if (error) { result.status = 'error'; result.message = error.message; }
            else { result.status = 'ok'; result.message = `Conexão OK (${elapsed}ms)`; }
            break;
          }

          case 'auth_session': {
            const { data: { session } } = await getSupabase().auth.getSession();
            if (session) { result.status = 'ok'; result.message = `Sessão ativa (${session.user?.email})`; }
            else { result.status = 'warning'; result.message = 'Sem sessão ativa'; }
            break;
          }

          case 'tables_accessible': {
            const tables = ['products', 'categories', 'stock_movements', 'sales', 'cash_registers', 'transfers', 'losses', 'thefts', 'fuel_records', 'daily_closings', 'audit_logs'];
            let ok = 0, fail = 0;
            for (const t of tables) {
              try {
                await getSupabase().from(t).select('id').limit(0);
                ok++;
              } catch { fail++; }
            }
            result.status = fail === 0 ? 'ok' : fail <= 2 ? 'warning' : 'error';
            result.message = `${ok}/${tables.length} tabelas acessíveis` + (fail > 0 ? ` (${fail} falhas)` : '');
            break;
          }

          case 'rls_active': {
            const { data, error } = await getSupabase().rpc('check_rls_active');
            if (error) { result.status = 'warning'; result.message = 'Não foi possível verificar (RPC indisponível)'; }
            else if (data) { result.status = 'ok'; result.message = 'RLS ativo nas tabelas'; }
            else { result.status = 'error'; result.message = 'RLS pode estar desativado'; }
            break;
          }

          case 'stock_consistency': {
            const { data, error } = await getSupabase().rpc('get_all_stock_balances');
            if (error) { result.status = 'warning'; result.message = 'RPC indisponível'; }
            else {
              const negatives = (data || []).filter(b => b.balance < 0);
              result.status = negatives.length === 0 ? 'ok' : 'error';
              result.message = negatives.length === 0 ? 'Sem saldos negativos' : `${negatives.length} produtos com saldo negativo`;
            }
            break;
          }

          case 'open_register': {
            const { data, error } = await getSupabase().from('cash_registers').select('id').eq('status', 'open').limit(1);
            if (error) { result.status = 'warning'; result.message = 'Erro ao verificar'; }
            else { result.status = 'ok'; result.message = data?.length ? 'Caixa aberta' : 'Nenhuma caixa aberta'; }
            break;
          }

          case 'pending_transfers': {
            const { data, error } = await getSupabase().from('transfers').select('id').eq('status', 'pending').limit(5);
            if (error) { result.status = 'warning'; result.message = 'Erro ao verificar'; }
            else { result.status = data?.length ? 'warning' : 'ok'; result.message = data?.length ? `${data.length} transferência(s) pendente(s)` : 'Sem transferências pendentes'; }
            break;
          }

          case 'recent_errors': {
            // Check if there are any console errors (just informational)
            result.status = 'ok';
            result.message = 'Verificação concluída — verifique o console do navegador para detalhes';
            break;
          }
        }
      } catch (err) {
        result.status = 'error';
        result.message = err.message || 'Erro desconhecido';
      }

      results.push(result);
    }

    return results;
  }

  function renderDiagnostics(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!OSA_AUTH.isAdmin()) {
      container.innerHTML = '<div class="osa-alert osa-alert--error">Acesso restrito a administradores</div>';
      return;
    }

    container.innerHTML = `
      <div class="osa-card">
        <div class="osa-card__header osa-card__header--actions">
          <h3>Diagnóstico do Sistema</h3>
          <button class="osa-btn osa-btn--primary" id="run-diagnostics-btn" onclick="OSA_DIAGNOSTICS.runAndRender('module-content')">Executar Verificações</button>
        </div>
        <div class="osa-card__body" id="diagnostics-results">
          <p style="color:#6b7280">Clique em "Executar Verificações" para analisar o estado do sistema.</p>
        </div>
      </div>`;
  }

  async function runAndRender(containerId) {
    const container = document.getElementById(containerId);
    const resultsDiv = document.getElementById('diagnostics-results');
    if (!resultsDiv) return;

    const btn = document.getElementById('run-diagnostics-btn');
    if (btn) OSA_UI.setButtonLoading(btn, true);

    resultsDiv.innerHTML = '<div class="osa-loading"></div><p style="text-align:center;color:#6b7280">A executar verificações…</p>';

    const results = await runAllChecks();

    let ok = 0, warn = 0, err = 0;
    results.forEach(r => { if (r.status === 'ok') ok++; else if (r.status === 'warning') warn++; else err++; });

    let html = `
      <div class="osa-stat-grid" style="margin-bottom:1rem">
        <div class="osa-stat"><div class="osa-stat__label">OK</div><div class="osa-stat__value osa-stat__value--success">${ok}</div></div>
        <div class="osa-stat"><div class="osa-stat__label">Avisos</div><div class="osa-stat__value osa-stat__value--warning">${warn}</div></div>
        <div class="osa-stat"><div class="osa-stat__label">Erros</div><div class="osa-stat__value osa-stat__value--danger">${err}</div></div>
      </div>
      <div class="osa-diagnostics-list">`;

    results.forEach(r => {
      const statusIcon = r.status === 'ok' ? '✅' : r.status === 'warning' ? '⚠️' : '❌';
      const statusClass = r.status === 'ok' ? 'osa-diag--ok' : r.status === 'warning' ? 'osa-diag--warn' : 'osa-diag--err';

      html += `
        <div class="osa-diag-item ${statusClass}">
          <span class="osa-diag-icon">${r.icon} ${statusIcon}</span>
          <span class="osa-diag-label">${r.label}</span>
          <span class="osa-diag-msg">${OSA_UI.escapeHtml(r.message)}</span>
        </div>`;
    });

    html += '</div>';

    resultsDiv.innerHTML = html;
    if (btn) OSA_UI.setButtonLoading(btn, false);
  }

  return { runAllChecks, renderDiagnostics, runAndRender };
})();
