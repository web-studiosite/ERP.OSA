/**
 * OSA — Audit Log Viewer
 */

const OSA_AUDIT = (() => {

  async function list(filters = {}) {
    const opts = { order: { column: 'created_at', ascending: false } };

    const conditions = [];
    if (filters.table_name) conditions.push({ column: 'table_name', operator: 'eq', value: filters.table_name });
    if (filters.action) conditions.push({ column: 'action', operator: 'eq', value: filters.action });
    if (filters.user_id) conditions.push({ column: 'user_id', operator: 'eq', value: filters.user_id });
    if (filters.dateRange) opts.dateRange = filters.dateRange;

    if (conditions.length) opts.filters = conditions;

    return OSA_DATA.read('audit_logs', opts);
  }

  const TABLE_LABELS = {
    products: 'Produtos',
    categories: 'Categorias',
    stock_movements: 'Mov. Stock',
    sales: 'Vendas',
    sale_items: 'Items Venda',
    cash_registers: 'Caixa',
    cash_movements: 'Mov. Caixa',
    transfers: 'Transferências',
    transfer_items: 'Items Transf.',
    losses: 'Perdas',
    thefts: 'Furtos',
    fuel_records: 'Combustível',
    inventories: 'Inventários',
    inventory_items: 'Items Inventário',
    daily_closings: 'Fechos Diários',
    profiles: 'Utilizadores',
    configs: 'Configurações'
  };

  const ACTION_LABELS = {
    CREATE: { label: 'Criado', class: 'osa-badge--success' },
    UPDATE: { label: 'Atualizado', class: 'osa-badge--warning' },
    DELETE: { label: 'Apagado', class: 'osa-badge--danger' }
  };

  function renderLog(containerId, dateFilter = 'last7', tableFilter = '') {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!OSA_AUTH.isJuniorAdminOrAbove()) {
      container.innerHTML = '<div class="osa-alert osa-alert--error">Acesso restrito</div>';
      return;
    }

    OSA_UI.setLoading(containerId, true);

    const range = OSA_UI.getDateRange(dateFilter);

    const filters = {
      dateRange: { column: 'created_at', from: range.from, to: range.to }
    };
    if (tableFilter) filters.table_name = tableFilter;

    list(filters).then(res => {
      if (!res.ok) {
        container.innerHTML = `<div class="osa-alert osa-alert--error">${OSA_UI.escapeHtml(res.error)}</div>`;
        return;
      }

      const logs = res.data || [];

      let html = `
        <div class="osa-card">
          <div class="osa-card__header osa-card__header--actions">
            <h3>Registo de Auditoria</h3>
            <div class="osa-filter-row">
              <select onchange="OSA_AUDIT.renderLog('module-content', document.getElementById('audit-date-filter').value, this.value)">
                <option value="">Todas as Tabelas</option>
                ${Object.entries(TABLE_LABELS).map(([k, v]) => `<option value="${k}" ${tableFilter === k ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
              <select id="audit-date-filter" onchange="OSA_AUDIT.renderLog('module-content', this.value, document.querySelector('.osa-filter-row select:first-child').value)">
                ${Object.entries(OSA_CONFIG.DATE_FILTERS).map(([k, v]) => `<option value="${k}" ${dateFilter === k ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
              <button class="osa-btn osa-btn--sm osa-btn--outline" onclick="OSA_AUDIT.exportLog()">Exportar</button>
            </div>
          </div>
          <div class="osa-card__body">`;

      if (!logs.length) {
        html += OSA_UI.emptyState('Nenhum registo de auditoria');
      } else {
        html += `<table class="osa-table osa-table--compact"><thead><tr><th>Data/Hora</th><th>Utilizador</th><th>Ação</th><th>Tabela</th><th>Registo</th><th>Detalhes</th></tr></thead><tbody>`;

        logs.forEach(log => {
          const actionInfo = ACTION_LABELS[log.action] || { label: log.action, class: 'osa-badge--secondary' };
          html += `<tr>
            <td style="white-space:nowrap">${OSA_UI.formatDateTime(log.created_at)}</td>
            <td>${OSA_UI.escapeHtml(log.user_email || log.user_id?.substring(0, 8) || '—')}</td>
            <td><span class="osa-badge ${actionInfo.class}">${actionInfo.label}</span></td>
            <td>${TABLE_LABELS[log.table_name] || log.table_name}</td>
            <td class="osa-td--mono">${log.record_id ? log.record_id.substring(0, 8) + '…' : '—'}</td>
            <td><button class="osa-btn osa-btn--sm osa-btn--outline" onclick="OSA_AUDIT.viewDetail('${log.id}')">Ver</button></td>
          </tr>`;
        });

        html += '</tbody></table>';
      }

      html += '</div></div>';
      container.innerHTML = html;
    });
  }

  async function viewDetail(logId) {
    const res = await OSA_DATA.read('audit_logs', { single: true, filter: { column: 'id', value: logId } });
    if (!res.ok) { OSA_UI.showError('Registo não encontrado', res); return; }

    const log = res.data;
    const actionInfo = ACTION_LABELS[log.action] || { label: log.action, class: 'osa-badge--secondary' };

    const container = document.getElementById('module-content');
    container.innerHTML = `
      <div class="osa-card">
        <div class="osa-card__header osa-card__header--actions">
          <h3>Detalhe de Auditoria</h3>
          <button class="osa-btn osa-btn--secondary" onclick="OSA_AUDIT.renderLog('module-content')">← Voltar</button>
        </div>
        <div class="osa-card__body">
          <div class="osa-detail-grid">
            <div><strong>Data/Hora:</strong> ${OSA_UI.formatDateTime(log.created_at)}</div>
            <div><strong>Utilizador:</strong> ${OSA_UI.escapeHtml(log.user_email || log.user_id || '—')}</div>
            <div><strong>Ação:</strong> <span class="osa-badge ${actionInfo.class}">${actionInfo.label}</span></div>
            <div><strong>Tabela:</strong> ${TABLE_LABELS[log.table_name] || log.table_name}</div>
            <div><strong>ID Registo:</strong> <span class="osa-td--mono">${log.record_id || '—'}</span></div>
          </div>

          <div style="margin-top:1rem">
            <strong>Dados Anteriores:</strong>
            <pre class="osa-pre">${log.old_data ? JSON.stringify(log.old_data, null, 2) : '—'}</pre>
          </div>

          <div style="margin-top:0.5rem">
            <strong>Novos Dados:</strong>
            <pre class="osa-pre">${log.new_data ? JSON.stringify(log.new_data, null, 2) : '—'}</pre>
          </div>
        </div>
      </div>`;
  }

  async function exportLog() {
    const res = await list({ dateRange: { column: 'created_at', from: OSA_UI.getDateRange('last30').from, to: OSA_UI.getDateRange('last30').to } });
    if (!res.ok) return;

    const rows = (res.data || []).map(l => ({
      Data: OSA_UI.formatDateTime(l.created_at),
      Utilizador: l.user_email || '',
      Ação: l.action,
      Tabela: l.table_name,
      ID: l.record_id || ''
    }));

    OSA_UI.exportCSV(rows, 'audit_log');
  }

  return { list, renderLog, viewDetail, exportLog };
})();
