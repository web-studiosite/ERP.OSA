/**
 * OSA — Fuel Records Module
 */

const OSA_FUEL = (() => {

  async function list(filters = {}) {
    const opts = { order: { column: 'date', ascending: false } };
    if (filters.dateRange) opts.dateRange = filters.dateRange;
    return OSA_DATA.read('fuel_records', opts);
  }

  async function get(id) {
    return OSA_DATA.read('fuel_records', { single: true, filter: { column: 'id', value: id } });
  }

  async function create(data) {
    const userId = OSA_AUTH.getCurrentUser()?.id;

    const record = {
      vehicle: data.vehicle,
      driver: data.driver || null,
      date: data.date,
      liters: data.liters,
      cost_per_liter: data.cost_per_liter,
      total_cost: (parseFloat(data.liters) || 0) * (parseFloat(data.cost_per_liter) || 0),
      odometer: data.odometer || null,
      station: data.station || null,
      note: data.note || null,
      created_by: userId
    };

    const res = await OSA_DATA.create('fuel_records', record);
    if (res.ok) {
      await OSA_DATA.audit('CREATE', 'fuel_records', res.data.id, null, res.data);

      // Generate receipt
      const storeConfig = await _getStoreConfig();
      const receipt = OSA_UI.generateMovementReceiptHTML({
        movement_type: 'fuel',
        created_at: new Date().toISOString(),
        note: `Combustível: ${record.vehicle} — ${record.liters}L @ ${OSA_UI.formatCurrency(record.cost_per_liter)}/L = ${OSA_UI.formatCurrency(record.total_cost)}`
      }, storeConfig);
      OSA_UI.printReceipt(receipt);

      OSA_UI.notifySuccess('Registo de combustível criado');
    } else {
      OSA_UI.showError('Erro ao criar registo', res);
    }
    return res;
  }

  async function update(id, data) {
    const record = { ...data };
    record.total_cost = (parseFloat(record.liters) || 0) * (parseFloat(record.cost_per_liter) || 0);

    const res = await OSA_DATA.update('fuel_records', id, record);
    if (res.ok) {
      await OSA_DATA.audit('UPDATE', 'fuel_records', id, null, res.data);
      OSA_UI.notifySuccess('Registo atualizado');
    } else {
      OSA_UI.showError('Erro ao atualizar', res);
    }
    return res;
  }

  async function remove(id) {
    OSA_UI.confirm('Apagar este registo de combustível?', async () => {
      const res = await OSA_DATA.remove('fuel_records', id);
      if (res.ok) {
        await OSA_DATA.audit('DELETE', 'fuel_records', id, null, null);
        OSA_UI.notifySuccess('Registo apagado');
        renderList('module-content');
      } else {
        OSA_UI.showError('Erro ao apagar', res);
      }
    }, { danger: true });
  }

  async function _getStoreConfig() {
    const res = await OSA_DATA.read('configs', { single: true, filter: { column: 'key', value: 'store' } });
    return res.ok ? res.data?.value : null;
  }

  // --- Render list ---

  function renderList(containerId, dateFilter = 'last30') {
    const container = document.getElementById(containerId);
    if (!container) return;

    OSA_UI.setLoading(containerId, true);

    const range = OSA_UI.getDateRange(dateFilter);

    list({ dateRange: { column: 'date', from: range.from, to: range.to } }).then(res => {
      if (!res.ok) {
        container.innerHTML = `<div class="osa-alert osa-alert--error">${OSA_UI.escapeHtml(res.error)}</div>`;
        return;
      }

      const items = res.data || [];

      let html = `
        <div class="osa-card">
          <div class="osa-card__header osa-card__header--actions">
            <h3>Combustível</h3>
            <div>
              <select onchange="OSA_FUEL.renderList('module-content', this.value)">
                ${Object.entries(OSA_CONFIG.DATE_FILTERS).map(([k, v]) => `<option value="${k}" ${dateFilter === k ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
              <button class="osa-btn osa-btn--primary" onclick="OSA_FUEL.renderForm('module-content')">+ Novo Registo</button>
            </div>
          </div>
          <div class="osa-card__body">`;

      if (!items.length) {
        html += OSA_UI.emptyState('Nenhum registo de combustível');
      } else {
        let totalLiters = 0, totalCost = 0;
        html += `<table class="osa-table"><thead><tr><th>Data</th><th>Veículo</th><th>Condutor</th><th>Litros</th><th>Preço/L</th><th>Total</th><th>Odómetro</th><th>Ações</th></tr></thead><tbody>`;

        items.forEach(f => {
          totalLiters += parseFloat(f.liters) || 0;
          totalCost += parseFloat(f.total_cost) || 0;
          html += `<tr>
            <td>${OSA_UI.formatDate(f.date)}</td>
            <td>${OSA_UI.escapeHtml(f.vehicle)}</td>
            <td>${OSA_UI.escapeHtml(f.driver || '—')}</td>
            <td class="osa-td--number">${OSA_UI.formatNumber(f.liters, 2)}</td>
            <td class="osa-td--number">${OSA_UI.formatCurrency(f.cost_per_liter)}</td>
            <td class="osa-td--number">${OSA_UI.formatCurrency(f.total_cost)}</td>
            <td class="osa-td--number">${OSA_UI.formatNumber(f.odometer) || '—'}</td>
            <td>
              <button class="osa-btn osa-btn--sm osa-btn--outline" onclick="OSA_FUEL.renderForm('module-content','${f.id}')">Editar</button>
              <button class="osa-btn osa-btn--sm osa-btn--danger" onclick="OSA_FUEL.remove('${f.id}')">Apagar</button>
            </td>
          </tr>`;
        });

        html += `</tbody><tfoot><tr><td colspan="3"><strong>Total</strong></td><td class="osa-td--number"><strong>${OSA_UI.formatNumber(totalLiters, 2)} L</strong></td><td></td><td class="osa-td--number"><strong>${OSA_UI.formatCurrency(totalCost)}</strong></td><td colspan="2"></td></tr></tfoot></table>`;
      }

      html += '</div></div>';
      container.innerHTML = html;
    });
  }

  // --- New/Edit form ---

  async function renderForm(containerId, editId = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let existing = null;
    if (editId) {
      const res = await get(editId);
      if (res.ok) existing = res.data;
    }

    container.innerHTML = `
      <div class="osa-card">
        <div class="osa-card__header"><h3>${existing ? 'Editar' : 'Novo'} Registo de Combustível</h3></div>
        <div class="osa-card__body">
          <form id="fuel-form" class="osa-form">
            <div class="osa-form__row">
              <div class="osa-form__group">
                <label>Veículo *</label>
                <input type="text" name="vehicle" value="${OSA_UI.escapeHtml(existing?.vehicle || '')}" required>
              </div>
              <div class="osa-form__group">
                <label>Condutor</label>
                <input type="text" name="driver" value="${OSA_UI.escapeHtml(existing?.driver || '')}">
              </div>
            </div>
            <div class="osa-form__row">
              <div class="osa-form__group">
                <label>Data *</label>
                <input type="date" name="date" value="${existing?.date || new Date().toISOString().split('T')[0]}" required>
              </div>
              <div class="osa-form__group">
                <label>Litros *</label>
                <input type="number" name="liters" step="0.01" min="0.01" value="${existing?.liters || ''}" required>
              </div>
            </div>
            <div class="osa-form__row">
              <div class="osa-form__group">
                <label>Preço/Litro (MZN) *</label>
                <input type="number" name="cost_per_liter" step="0.01" min="0" value="${existing?.cost_per_liter || ''}" required>
              </div>
              <div class="osa-form__group">
                <label>Odómetro (km)</label>
                <input type="number" name="odometer" min="0" value="${existing?.odometer || ''}">
              </div>
            </div>
            <div class="osa-form__row">
              <div class="osa-form__group">
                <label>Posto</label>
                <input type="text" name="station" value="${OSA_UI.escapeHtml(existing?.station || '')}">
              </div>
              <div class="osa-form__group">
                <label>Nota</label>
                <input type="text" name="note" value="${OSA_UI.escapeHtml(existing?.note || '')}">
              </div>
            </div>
            <div id="fuel-total-preview" style="margin:0.5rem 0;padding:0.5rem;background:#ecfdf5;border-radius:6px">
              <strong>Total:</strong> <span id="fuel-total-value">${existing ? OSA_UI.formatCurrency(existing.total_cost) : '—'}</span>
            </div>
            <div class="osa-form__actions">
              <button type="submit" class="osa-btn osa-btn--primary">${existing ? 'Guardar' : 'Criar'}</button>
              <button type="button" class="osa-btn osa-btn--secondary" onclick="OSA_FUEL.renderList('module-content')">Cancelar</button>
            </div>
          </form>
        </div>
      </div>`;

    // Update total preview
    const updateTotal = () => {
      const l = parseFloat(document.querySelector('[name=liters]').value) || 0;
      const p = parseFloat(document.querySelector('[name=cost_per_liter]').value) || 0;
      document.getElementById('fuel-total-value').textContent = OSA_UI.formatCurrency(l * p);
    };

    document.querySelector('[name=liters]').oninput = updateTotal;
    document.querySelector('[name=cost_per_liter]').oninput = updateTotal;

    document.getElementById('fuel-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);

      const btn = e.target.querySelector('[type=submit]');
      OSA_UI.setButtonLoading(btn, true);

      const data = {
        vehicle: fd.get('vehicle'),
        driver: fd.get('driver'),
        date: fd.get('date'),
        liters: fd.get('liters'),
        cost_per_liter: fd.get('cost_per_liter'),
        odometer: fd.get('odometer') || null,
        station: fd.get('station'),
        note: fd.get('note')
      };

      if (existing) {
        await update(existing.id, data);
      } else {
        await create(data);
      }

      OSA_UI.setButtonLoading(btn, false);
      renderList('module-content');
    };
  }

  return { list, get, create, update, remove, renderList, renderForm };
})();
