/**
 * OSA — Losses Module
 */

const OSA_LOSSES = (() => {

  async function list(filters = {}) {
    const opts = { order: { column: 'created_at', ascending: false } };
    if (filters.dateRange) opts.dateRange = filters.dateRange;
    return OSA_DATA.read('losses', opts);
  }

  async function get(id) {
    return OSA_DATA.read('losses', { single: true, filter: { column: 'id', value: id } });
  }

  async function create(data) {
    const userId = OSA_AUTH.getCurrentUser()?.id;

    // 1. Create loss record
    const record = {
      product_id: data.product_id,
      quantity: data.quantity,
      location: data.location,
      reason: data.reason || 'other',
      note: data.note || null,
      cost_value: data.cost_value || 0,
      created_by: userId
    };

    const res = await OSA_DATA.create('losses', record);

    if (res.ok) {
      // 2. Register stock movement (loss = stock out)
      await OSA_STOCK.registerMovement({
        product_id: data.product_id,
        movement_type: 'loss',
        quantity: data.quantity,
        location: data.location,
        unit_cost: data.cost_value / data.quantity,
        total_cost: data.cost_value,
        note: `Perda: ${data.reason}. ${data.note || ''}`
      });

      await OSA_DATA.audit('CREATE', 'losses', res.data.id, null, res.data);
      OSA_UI.notifySuccess('Perda registada e stock ajustado');
    } else {
      OSA_UI.showError('Erro ao registar perda', res);
    }

    return res;
  }

  const REASONS = {
    expired: 'Expirado',
    damaged: 'Danificado',
    spoiled: 'Estragado',
    quality: 'Problema de Qualidade',
    other: 'Outro'
  };

  // --- Render list ---

  function renderList(containerId, dateFilter = 'last30') {
    const container = document.getElementById(containerId);
    if (!container) return;

    OSA_UI.setLoading(containerId, true);

    const range = OSA_UI.getDateRange(dateFilter);

    list({ dateRange: { column: 'created_at', from: range.from, to: range.to } }).then(res => {
      if (!res.ok) {
        container.innerHTML = `<div class="osa-alert osa-alert--error">${OSA_UI.escapeHtml(res.error)}</div>`;
        return;
      }

      const items = res.data || [];

      let html = `
        <div class="osa-card">
          <div class="osa-card__header osa-card__header--actions">
            <h3>Perdas</h3>
            <div>
              <select onchange="OSA_LOSSES.renderList('module-content', this.value)">
                ${Object.entries(OSA_CONFIG.DATE_FILTERS).map(([k, v]) => `<option value="${k}" ${dateFilter === k ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
              ${OSA_AUTH.isJuniorAdminOrAbove() ? '<button class="osa-btn osa-btn--primary" onclick="OSA_LOSSES.renderForm(\'module-content\')">+ Registar Perda</button>' : ''}
            </div>
          </div>
          <div class="osa-card__body">`;

      if (!items.length) {
        html += OSA_UI.emptyState('Nenhuma perda registada');
      } else {
        let totalValue = 0;
        html += `<table class="osa-table"><thead><tr><th>Data</th><th>Produto</th><th>Qtd</th><th>Local</th><th>Motivo</th><th>Valor</th><th>Nota</th></tr></thead><tbody>`;

        items.forEach(l => {
          totalValue += l.cost_value || 0;
          html += `<tr>
            <td>${OSA_UI.formatDateTime(l.created_at)}</td>
            <td>${OSA_UI.escapeHtml(l.product_name || '')}</td>
            <td class="osa-td--number">${OSA_UI.formatNumber(l.quantity)}</td>
            <td>${OSA_CONFIG.LOCATIONS[l.location] || l.location}</td>
            <td><span class="osa-badge osa-badge--danger">${REASONS[l.reason] || l.reason}</span></td>
            <td class="osa-td--number">${OSA_AUTH.canSeeCosts() ? OSA_UI.formatCurrency(l.cost_value) : '—'}</td>
            <td>${OSA_UI.escapeHtml(l.note || '')}</td>
          </tr>`;
        });

        html += `</tbody><tfoot><tr><td colspan="5"><strong>Total Perdas</strong></td><td class="osa-td--number"><strong>${OSA_AUTH.canSeeCosts() ? OSA_UI.formatCurrency(totalValue) : '—'}</strong></td><td></td></tr></tfoot></table>`;
      }

      html += '</div></div>';
      container.innerHTML = html;
    });
  }

  // --- New loss form ---

  async function renderForm(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const productsRes = await OSA_DATA.read('products', {
      filters: [{ column: 'is_active', operator: 'eq', value: true }],
      order: { column: 'name', ascending: true }
    });
    const products = productsRes.ok ? (productsRes.data || []) : [];

    container.innerHTML = `
      <div class="osa-card">
        <div class="osa-card__header"><h3>Registar Perda</h3></div>
        <div class="osa-card__body">
          <form id="loss-form" class="osa-form">
            <div class="osa-form__row">
              <div class="osa-form__group">
                <label>Produto *</label>
                <select name="product_id" id="loss-product" required>
                  <option value="">Selecione</option>
                  ${products.map(p => `<option value="${p.id}" data-cost="${p.cost_price}">${OSA_UI.escapeHtml(p.name)}</option>`).join('')}
                </select>
              </div>
              <div class="osa-form__group">
                <label>Quantidade *</label>
                <input type="number" name="quantity" min="1" value="1" required>
              </div>
            </div>
            <div class="osa-form__row">
              <div class="osa-form__group">
                <label>Local *</label>
                <select name="location" required>
                  ${Object.entries(OSA_CONFIG.LOCATIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
                </select>
              </div>
              <div class="osa-form__group">
                <label>Motivo *</label>
                <select name="reason" required>
                  ${Object.entries(REASONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="osa-form__group">
              <label>Nota</label>
              <textarea name="note" rows="2"></textarea>
            </div>
            <div id="loss-cost-preview" style="margin:0.5rem 0;padding:0.5rem;background:#fef2f2;border-radius:6px;display:none">
              <strong>Custo estimado:</strong> <span id="loss-cost-value"></span>
            </div>
            <div class="osa-form__actions">
              <button type="submit" class="osa-btn osa-btn--danger">Registar Perda</button>
              <button type="button" class="osa-btn osa-btn--secondary" onclick="OSA_LOSSES.renderList('module-content')">Cancelar</button>
            </div>
          </form>
        </div>
      </div>`;

    // Update cost preview
    const updateCost = () => {
      const sel = document.getElementById('loss-product');
      const opt = sel.selectedOptions[0];
      const cost = parseFloat(opt?.dataset.cost || 0);
      const qty = parseInt(document.querySelector('[name=quantity]').value) || 1;

      if (OSA_AUTH.canSeeCosts() && cost > 0) {
        document.getElementById('loss-cost-preview').style.display = '';
        document.getElementById('loss-cost-value').textContent = OSA_UI.formatCurrency(cost * qty);
      }
    };

    document.getElementById('loss-product').onchange = updateCost;
    document.querySelector('[name=quantity]').oninput = updateCost;

    document.getElementById('loss-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);

      const sel = document.getElementById('loss-product');
      const opt = sel.selectedOptions[0];
      const costPrice = parseFloat(opt?.dataset.cost || 0);
      const qty = parseInt(fd.get('quantity')) || 1;

      const btn = e.target.querySelector('[type=submit]');
      OSA_UI.setButtonLoading(btn, true);

      await create({
        product_id: fd.get('product_id'),
        quantity: qty,
        location: fd.get('location'),
        reason: fd.get('reason'),
        note: fd.get('note'),
        cost_value: costPrice * qty
      });

      OSA_UI.setButtonLoading(btn, false);
      renderList('module-content');
    };
  }

  return { list, get, create, renderList, renderForm };
})();
