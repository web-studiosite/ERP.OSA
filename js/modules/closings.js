/**
 * OSA — Daily Closings Module
 */

const OSA_CLOSINGS = (() => {

  async function list(dateFilter = 'last30') {
    const range = OSA_UI.getDateRange(dateFilter);
    return OSA_DATA.read('daily_closings', {
      filters: [
        { column: 'closing_date', operator: 'gte', value: range.from },
        { column: 'closing_date', operator: 'lte', value: range.to }
      ],
      order: { column: 'closing_date', ascending: false }
    });
  }

  async function get(id) {
    return OSA_DATA.read('daily_closings', { single: true, filter: { column: 'id', value: id } });
  }

  async function create(closingDate) {
    const userId = OSA_AUTH.getCurrentUser()?.id;

    // Calculate day's summary
    const startOfDay = closingDate + 'T00:00:00';
    const endOfDay = closingDate + 'T23:59:59';

    const salesRes = await OSA_DATA.read('sales', {
      filters: [
        { column: 'created_at', operator: 'gte', value: startOfDay },
        { column: 'created_at', operator: 'lte', value: endOfDay }
      ]
    });

    const lossesRes = await OSA_DATA.read('losses', {
      filters: [
        { column: 'created_at', operator: 'gte', value: startOfDay },
        { column: 'created_at', operator: 'lte', value: endOfDay }
      ]
    });

    const theftsRes = await OSA_DATA.read('thefts', {
      filters: [
        { column: 'created_at', operator: 'gte', value: startOfDay },
        { column: 'created_at', operator: 'lte', value: endOfDay }
      ]
    });

    const sales = salesRes.ok ? (salesRes.data || []) : [];
    const losses = lossesRes.ok ? (lossesRes.data || []) : [];
    const thefts = theftsRes.ok ? (theftsRes.data || []) : [];

    const totalRevenue = sales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);
    const totalCost = sales.reduce((sum, s) => sum + (parseFloat(s.cost_total) || 0), 0);
    const totalDiscount = sales.reduce((sum, s) => sum + (parseFloat(s.discount) || 0), 0);
    const totalLossValue = losses.reduce((sum, l) => sum + (parseFloat(l.cost_value) || 0), 0);
    const totalTheftValue = thefts.reduce((sum, t) => sum + (parseFloat(t.cost_value) || 0), 0);
    const salesCount = sales.length;

    const record = {
      closing_date: closingDate,
      sales_count: salesCount,
      total_revenue: totalRevenue,
      total_cost: totalCost,
      total_discount: totalDiscount,
      total_loss: totalLossValue,
      total_theft: totalTheftValue,
      net_result: totalRevenue - totalCost - totalLossValue - totalTheftValue,
      closed_by: userId,
      status: 'closed'
    };

    const res = await OSA_DATA.create('daily_closings', record);

    if (res.ok) {
      await OSA_DATA.audit('CREATE', 'daily_closings', res.data.id, null, res.data);

      // Generate closing receipt
      const storeConfig = await _getStoreConfig();
      const receiptHtml = _buildClosingReceipt(res.data, storeConfig);
      OSA_UI.printReceipt(receiptHtml);

      OSA_UI.notifySuccess(`Fecho diário de ${OSA_UI.formatDate(closingDate)} registado`);
    } else {
      OSA_UI.showError('Erro ao registar fecho', res);
    }

    return res;
  }

  async function _getStoreConfig() {
    const res = await OSA_DATA.read('configs', { single: true, filter: { column: 'key', value: 'store' } });
    return res.ok ? res.data?.value : null;
  }

  function _buildClosingReceipt(closing, storeConfig) {
    const storeName = storeConfig?.name || 'Loja';
    const storeNuit = storeConfig?.nuit || '';
    const accentColor = storeConfig?.accent_color || '#059669';

    return `
      <div class="osa-receipt" style="font-family:monospace;max-width:320px;margin:0 auto;padding:16px">
        <div style="text-align:center;border-bottom:2px solid ${accentColor};padding-bottom:8px;margin-bottom:8px">
          <div style="font-size:10px;color:#6b7280">OSA — OFFICIAL SHOP ADMINISTRATOR</div>
          <div style="font-weight:700;font-size:16px">${OSA_UI.escapeHtml(storeName)}</div>
          ${storeNuit ? `<div style="font-size:11px">NUIT: ${OSA_UI.escapeHtml(storeNuit)}</div>` : ''}
          <div style="font-size:12px;font-weight:600;margin-top:4px">FECHO DIÁRIO</div>
          <div style="font-size:11px">${OSA_UI.formatDate(closing.closing_date)}</div>
        </div>

        <div style="font-size:11px">
          <div style="display:flex;justify-content:space-between"><span>Vendas:</span><span>${closing.sales_count}</span></div>
          <div style="display:flex;justify-content:space-between"><span>Receita:</span><span>${OSA_UI.formatCurrency(closing.total_revenue)}</span></div>
          <div style="display:flex;justify-content:space-between"><span>Custo:</span><span>${OSA_UI.formatCurrency(closing.total_cost)}</span></div>
          <div style="display:flex;justify-content:space-between"><span>Descontos:</span><span>${OSA_UI.formatCurrency(closing.total_discount)}</span></div>
          <div style="display:flex;justify-content:space-between"><span>Perdas:</span><span>${OSA_UI.formatCurrency(closing.total_loss)}</span></div>
          <div style="display:flex;justify-content:space-between"><span>Furtos:</span><span>${OSA_UI.formatCurrency(closing.total_theft)}</span></div>
          <div style="border-top:1px dashed #333;margin-top:6px;padding-top:6px;display:flex;justify-content:space-between;font-weight:700">
            <span>Resultado Líquido:</span><span>${OSA_UI.formatCurrency(closing.net_result)}</span>
          </div>
        </div>

        <div style="text-align:center;font-size:10px;color:#9ca3af;margin-top:8px;border-top:1px solid #e5e7eb;padding-top:8px">
          Gerado por OSA · ${OSA_UI.formatDateTime(new Date().toISOString())}
        </div>
      </div>`;
  }

  // --- Render list ---

  function renderList(containerId, dateFilter = 'last30') {
    const container = document.getElementById(containerId);
    if (!container) return;

    OSA_UI.setLoading(containerId, true);

    list(dateFilter).then(res => {
      if (!res.ok) {
        container.innerHTML = `<div class="osa-alert osa-alert--error">${OSA_UI.escapeHtml(res.error)}</div>`;
        return;
      }

      const items = res.data || [];

      let html = `
        <div class="osa-card">
          <div class="osa-card__header osa-card__header--actions">
            <h3>Fechos Diários</h3>
            <div>
              <select onchange="OSA_CLOSINGS.renderList('module-content', this.value)">
                ${Object.entries(OSA_CONFIG.DATE_FILTERS).map(([k, v]) => `<option value="${k}" ${dateFilter === k ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
              ${OSA_AUTH.isJuniorAdminOrAbove() ? '<button class="osa-btn osa-btn--primary" onclick="OSA_CLOSINGS.renderNewForm(\'module-content\')">+ Novo Fecho</button>' : ''}
            </div>
          </div>
          <div class="osa-card__body">`;

      if (!items.length) {
        html += OSA_UI.emptyState('Nenhum fecho diário registado');
      } else {
        html += `<table class="osa-table"><thead><tr><th>Data</th><th>Vendas</th><th>Receita</th><th>Perdas</th><th>Furtos</th><th>Líquido</th><th>Ações</th></tr></thead><tbody>`;

        items.forEach(c => {
          html += `<tr>
            <td>${OSA_UI.formatDate(c.closing_date)}</td>
            <td class="osa-td--number">${OSA_UI.formatNumber(c.sales_count)}</td>
            <td class="osa-td--number">${OSA_UI.formatCurrency(c.total_revenue)}</td>
            <td class="osa-td--number">${OSA_AUTH.canSeeCosts() ? OSA_UI.formatCurrency(c.total_loss) : '—'}</td>
            <td class="osa-td--number">${OSA_AUTH.canSeeCosts() ? OSA_UI.formatCurrency(c.total_theft) : '—'}</td>
            <td class="osa-td--number"><strong>${OSA_AUTH.canSeeCosts() ? OSA_UI.formatCurrency(c.net_result) : '—'}</strong></td>
            <td>
              <button class="osa-btn osa-btn--sm osa-btn--outline" onclick="OSA_CLOSINGS.viewDetail('${c.id}')">Ver</button>
            </td>
          </tr>`;
        });

        html += '</tbody></table>';
      }

      html += '</div></div>';
      container.innerHTML = html;
    });
  }

  // --- New closing form ---

  function renderNewForm(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const today = new Date().toISOString().split('T')[0];

    container.innerHTML = `
      <div class="osa-card">
        <div class="osa-card__header"><h3>Novo Fecho Diário</h3></div>
        <div class="osa-card__body">
          <form id="closing-form" class="osa-form">
            <div class="osa-form__group">
              <label>Data *</label>
              <input type="date" name="closing_date" value="${today}" required>
            </div>
            <div class="osa-alert osa-alert--info" style="margin-bottom:1rem">
              O sistema calculará automaticamente o resumo do dia (vendas, perdas, furtos) e gerará o recibo de fecho.
            </div>
            <div class="osa-form__actions">
              <button type="submit" class="osa-btn osa-btn--primary">Registar Fecho</button>
              <button type="button" class="osa-btn osa-btn--secondary" onclick="OSA_CLOSINGS.renderList('module-content')">Cancelar</button>
            </div>
          </form>
        </div>
      </div>`;

    document.getElementById('closing-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('[type=submit]');

      OSA_UI.setButtonLoading(btn, true);
      await create(fd.get('closing_date'));
      OSA_UI.setButtonLoading(btn, false);

      renderList('module-content');
    };
  }

  // --- View detail ---

  async function viewDetail(id) {
    const res = await get(id);
    if (!res.ok) { OSA_UI.showError('Fecho não encontrado', res); return; }

    const c = res.data;
    const storeConfig = await _getStoreConfig();

    const container = document.getElementById('module-content');
    container.innerHTML = `
      <div class="osa-card">
        <div class="osa-card__header osa-card__header--actions">
          <h3>Fecho Diário — ${OSA_UI.formatDate(c.closing_date)}</h3>
          <button class="osa-btn osa-btn--outline" onclick="OSA_CLOSINGS.reprintReceipt('${c.id}')">Reimprimir Recibo</button>
        </div>
        <div class="osa-card__body">
          <div class="osa-stat-grid">
            <div class="osa-stat"><div class="osa-stat__label">Vendas</div><div class="osa-stat__value">${OSA_UI.formatNumber(c.sales_count)}</div></div>
            <div class="osa-stat"><div class="osa-stat__label">Receita</div><div class="osa-stat__value osa-stat__value--success">${OSA_UI.formatCurrency(c.total_revenue)}</div></div>
            <div class="osa-stat"><div class="osa-stat__label">Custo</div><div class="osa-stat__value">${OSA_AUTH.canSeeCosts() ? OSA_UI.formatCurrency(c.total_cost) : '—'}</div></div>
            <div class="osa-stat"><div class="osa-stat__label">Descontos</div><div class="osa-stat__value osa-stat__value--warning">${OSA_UI.formatCurrency(c.total_discount)}</div></div>
            <div class="osa-stat"><div class="osa-stat__label">Perdas</div><div class="osa-stat__value osa-stat__value--danger">${OSA_AUTH.canSeeCosts() ? OSA_UI.formatCurrency(c.total_loss) : '—'}</div></div>
            <div class="osa-stat"><div class="osa-stat__label">Furtos</div><div class="osa-stat__value osa-stat__value--danger">${OSA_AUTH.canSeeCosts() ? OSA_UI.formatCurrency(c.total_theft) : '—'}</div></div>
            <div class="osa-stat"><div class="osa-stat__label">Resultado Líquido</div><div class="osa-stat__value osa-stat__value--primary">${OSA_AUTH.canSeeCosts() ? OSA_UI.formatCurrency(c.net_result) : '—'}</div></div>
          </div>

          <div style="margin-top:1rem">
            <button class="osa-btn osa-btn--secondary" onclick="OSA_CLOSINGS.renderList('module-content')">← Voltar</button>
          </div>
        </div>
      </div>`;
  }

  async function reprintReceipt(id) {
    const res = await get(id);
    if (!res.ok) return;

    const storeConfig = await _getStoreConfig();
    const receiptHtml = _buildClosingReceipt(res.data, storeConfig);
    OSA_UI.printReceipt(receiptHtml);
  }

  return { list, get, create, renderList, renderNewForm, viewDetail, reprintReceipt };
})();
