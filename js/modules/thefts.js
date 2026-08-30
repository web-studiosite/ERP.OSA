/**
 * OSA — Thefts Module
 */

const OSA_THEFTS = (() => {

  async function list(filters = {}) {
    const opts = { order: { column: 'created_at', ascending: false } };
    if (filters.dateRange) opts.dateRange = filters.dateRange;
    return OSA_DATA.read('thefts', opts);
  }

  async function get(id) {
    return OSA_DATA.read('thefts', { single: true, filter: { column: 'id', value: id } });
  }

  async function create(data) {
    const userId = OSA_AUTH.getCurrentUser()?.id;

    const record = {
      product_id: data.product_id,
      quantity: data.quantity,
      location: data.location,
      suspect: data.suspect || null,
      description: data.description || null,
      reported: data.reported || false,
      report_number: data.report_number || null,
      cost_value: data.cost_value || 0,
      retail_value: data.retail_value || 0,
      created_by: userId
    };

    const res = await OSA_DATA.create('thefts', record);

    if (res.ok) {
      // Register stock movement (theft = stock out)
      await OSA_STOCK.registerMovement({
        product_id: data.product_id,
        movement_type: 'theft',
        quantity: data.quantity,
        location: data.location,
        unit_cost: data.cost_value / data.quantity,
        total_cost: data.cost_value,
        note: `Furto: ${data.description || 'Não especificado'}`
      });

      await OSA_DATA.audit('CREATE', 'thefts', res.data.id, null, res.data);
      OSA_UI.notifySuccess('Furto registado e stock ajustado');
    } else {
      OSA_UI.showError('Erro ao registar furto', res);
    }

    return res;
  }

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
            <h3>Furtos</h3>
            <div>
              <select onchange="OSA_THEFTS.renderList('module-content', this.value)">
                ${Object.entries(OSA_CONFIG.DATE_FILTERS).map(([k, v]) => `<option value="${k}" ${dateFilter === k ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
              ${OSA_AUTH.isAdmin() ? '<button class="osa-btn osa-btn--primary" onclick="OSA_THEFTS.renderForm(\'module-content\')">+ Registar Furto</button>' : ''}
            </div>
          </div>
          <div class="osa-card__body">`;

      if (!items.length) {
        html += OSA_UI.emptyState('Nenhum furto registado');
      } else {
        let totalCost = 0, totalRetail = 0;
        html += `<table class="osa-table"><thead><tr><th>Data</th><th>Produto</th><th>Qtd</th><th>Local</th><th>Suspeito</th><th>Participado</th><th>Valor Custo</th><th>Valor Venda</th></tr></thead><tbody>`;

        items.forEach(t => {
          totalCost += t.cost_value || 0;
          totalRetail += t.retail_value || 0;
          html += `<tr>
            <td>${OSA_UI.formatDateTime(t.created_at)}</td>
            <td>${OSA_UI.escapeHtml(t.product_name || '')}</td>
            <td class="osa-td--number">${OSA_UI.formatNumber(t.quantity)}</td>
            <td>${OSA_CONFIG.LOCATIONS[t.location] || t.location}</td>
            <td>${OSA_UI.escapeHtml(t.suspect || '—')}</td>
            <td><span class="osa-badge ${t.reported ? 'osa-badge--success' : 'osa-badge--warning'}">${t.reported ? 'Sim' : 'Não'}</span></td>
            <td class="osa-td--number">${OSA_AUTH.canSeeCosts() ? OSA_UI.formatCurrency(t.cost_value) : '—'}</td>
            <td class="osa-td--number">${OSA_UI.formatCurrency(t.retail_value)}</td>
          </tr>`;
        });

        html += `</tbody><tfoot><tr><td colspan="6"><strong>Total</strong></td><td class="osa-td--number"><strong>${OSA_AUTH.canSeeCosts() ? OSA_UI.formatCurrency(totalCost) : '—'}</strong></td><td class="osa-td--number"><strong>${OSA_UI.formatCurrency(totalRetail)}</strong></td></tr></tfoot></table>`;
      }

      html += '</div></div>';
      container.innerHTML = html;
    });
  }

  // --- New theft form ---

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
        <div class="osa-card__header"><h3>Registar Furto</h3></div>
        <div class="osa-card__body">
          <form id="theft-form" class="osa-form">
            <div class="osa-form__row">
              <div class="osa-form__group">
                <label>Produto *</label>
                <select name="product_id" id="theft-product" required>
                  <option value="">Selecione</option>
                  ${products.map(p => `<option value="${p.id}" data-cost="${p.cost_price}" data-price="${p.sell_price}">${OSA_UI.escapeHtml(p.name)}</option>`).join('')}
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
                <label>Suspeito</label>
                <input type="text" name="suspect" placeholder="Nome ou descrição">
              </div>
            </div>
            <div class="osa-form__row">
              <div class="osa-form__group">
                <label>Descrição</label>
                <textarea name="description" rows="2" placeholder="Detalhes do incidente"></textarea>
              </div>
              <div class="osa-form__group">
                <label>Participado à Polícia?</label>
                <label class="osa-checkbox"><input type="checkbox" name="reported"> Sim</label>
                <input type="text" name="report_number" placeholder="Nº do Participação" style="margin-top:0.5rem">
              </div>
            </div>
            <div id="theft-value-preview" style="margin:0.5rem 0;padding:0.5rem;background:#fef2f2;border-radius:6px;display:none">
              <strong>Custo:</strong> <span id="theft-cost-value"></span> | <strong>Venda:</strong> <span id="theft-retail-value"></span>
            </div>
            <div class="osa-form__actions">
              <button type="submit" class="osa-btn osa-btn--danger">Registar Furto</button>
              <button type="button" class="osa-btn osa-btn--secondary" onclick="OSA_THEFTS.renderList('module-content')">Cancelar</button>
            </div>
          </form>
        </div>
      </div>`;

    // Update value preview
    const updateValue = () => {
      const sel = document.getElementById('theft-product');
      const opt = sel.selectedOptions[0];
      const cost = parseFloat(opt?.dataset.cost || 0);
      const price = parseFloat(opt?.dataset.price || 0);
      const qty = parseInt(document.querySelector('[name=quantity]').value) || 1;

      if (opt?.value) {
        document.getElementById('theft-value-preview').style.display = '';
        if (OSA_AUTH.canSeeCosts())
          document.getElementById('theft-cost-value').textContent = OSA_UI.formatCurrency(cost * qty);
        document.getElementById('theft-retail-value').textContent = OSA_UI.formatCurrency(price * qty);
      }
    };

    document.getElementById('theft-product').onchange = updateValue;
    document.querySelector('[name=quantity]').oninput = updateValue;

    document.getElementById('theft-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);

      const sel = document.getElementById('theft-product');
      const opt = sel.selectedOptions[0];
      const costPrice = parseFloat(opt?.dataset.cost || 0);
      const sellPrice = parseFloat(opt?.dataset.price || 0);
      const qty = parseInt(fd.get('quantity')) || 1;

      const btn = e.target.querySelector('[type=submit]');
      OSA_UI.setButtonLoading(btn, true);

      await create({
        product_id: fd.get('product_id'),
        quantity: qty,
        location: fd.get('location'),
        suspect: fd.get('suspect'),
        description: fd.get('description'),
        reported: !!fd.get('reported'),
        report_number: fd.get('report_number'),
        cost_value: costPrice * qty,
        retail_value: sellPrice * qty
      });

      OSA_UI.setButtonLoading(btn, false);
      renderList('module-content');
    };
  }

  return { list, get, create, renderList, renderForm };
})();
