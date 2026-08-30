/**
 * OSA — Transfers Module
 * Uses process_transfer PostgreSQL function for atomic stock movement
 */

const OSA_TRANSFERS = (() => {

  async function list(filters = {}) {
    const opts = { order: { column: 'created_at', ascending: false } };
    if (filters.status) {
      opts.filters = [{ column: 'status', operator: 'eq', value: filters.status }];
    }
    return OSA_DATA.read('transfers', opts);
  }

  async function get(id) {
    return OSA_DATA.read('transfers', { single: true, filter: { column: 'id', value: id } });
  }

  async function getItems(transferId) {
    return OSA_DATA.read('transfer_items', {
      filters: [{ column: 'transfer_id', operator: 'eq', value: transferId }],
      order: { column: 'created_at', ascending: true }
    });
  }

  // --- Process transfer via PostgreSQL function (atomic) ---

  async function processTransfer(data) {
    // data: { from_location, to_location, items: [{ product_id, quantity }], note }
    const userId = OSA_AUTH.getCurrentUser()?.id;

    const res = await OSA_DATA.rpc('process_transfer', {
      p_from_location: data.from_location,
      p_to_location: data.to_location,
      p_items: data.items,
      p_note: data.note || null,
      p_created_by: userId
    });

    if (res.ok) {
      await OSA_DATA.audit('CREATE', 'transfers', res.data?.id, null, res.data);
      OSA_UI.notifySuccess('Transferência processada com sucesso');

      // Generate receipt
      const configs = await OSA_DATA.read('configs', { single: true, filter: { column: 'key', value: 'store' } });
      const storeConfig = configs.ok ? configs.data?.value : null;
      const items = data.items;
      const receipt = OSA_UI.generateTransferReceiptHTML(
        { reference: res.data?.reference, from_location: data.from_location, to_location: data.to_location, created_at: new Date().toISOString(), note: data.note },
        items.map(i => ({ product_name: i.product_name || i.product_id, quantity: i.quantity })),
        storeConfig
      );
      OSA_UI.printReceipt(receipt);
    } else {
      OSA_UI.showError('Erro ao processar transferência', res);
    }

    return res;
  }

  // --- Render transfers list ---

  function renderList(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    OSA_UI.setLoading(containerId, true);

    list().then(res => {
      if (!res.ok) {
        container.innerHTML = `<div class="osa-alert osa-alert--error">${OSA_UI.escapeHtml(res.error)}</div>`;
        return;
      }

      const items = res.data || [];

      let html = `
        <div class="osa-card">
          <div class="osa-card__header osa-card__header--actions">
            <h3>Transferências</h3>
            ${OSA_AUTH.isJuniorAdminOrAbove() ? '<button class="osa-btn osa-btn--primary" onclick="OSA_TRANSFERS.renderForm(\'module-content\')">+ Nova Transferência</button>' : ''}
          </div>
          <div class="osa-card__body">`;

      if (!items.length) {
        html += OSA_UI.emptyState('Nenhuma transferência registada');
      } else {
        html += `<table class="osa-table"><thead><tr><th>Ref.</th><th>De</th><th>Para</th><th>Status</th><th>Data</th><th>Nota</th><th>Ações</th></tr></thead><tbody>`;

        items.forEach(t => {
          const statusBadge = {
            completed: 'osa-badge--success',
            pending: 'osa-badge--warning',
            cancelled: 'osa-badge--danger'
          }[t.status] || 'osa-badge--secondary';

          html += `<tr>
            <td><code>${OSA_UI.escapeHtml(t.reference || '')}</code></td>
            <td>${OSA_CONFIG.LOCATIONS[t.from_location] || t.from_location}</td>
            <td>${OSA_CONFIG.LOCATIONS[t.to_location] || t.to_location}</td>
            <td><span class="osa-badge ${statusBadge}">${OSA_UI.escapeHtml(t.status)}</span></td>
            <td>${OSA_UI.formatDateTime(t.created_at)}</td>
            <td>${OSA_UI.escapeHtml(t.note || '')}</td>
            <td><button class="osa-btn osa-btn--sm osa-btn--outline" onclick="OSA_TRANSFERS.viewDetail('${t.id}')">Ver</button></td>
          </tr>`;
        });

        html += '</tbody></table>';
      }

      html += '</div></div>';
      container.innerHTML = html;
    });
  }

  // --- New transfer form ---

  async function renderForm(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const productsRes = await OSA_DATA.read('products', { filters: [{ column: 'is_active', operator: 'eq', value: true }], order: { column: 'name', ascending: true } });
    const products = productsRes.ok ? (productsRes.data || []) : [];

    container.innerHTML = `
      <div class="osa-card">
        <div class="osa-card__header"><h3>Nova Transferência</h3></div>
        <div class="osa-card__body">
          <form id="transfer-form" class="osa-form">
            <div class="osa-form__row">
              <div class="osa-form__group">
                <label>De *</label>
                <select name="from_location" required>
                  ${Object.entries(OSA_CONFIG.LOCATIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
                </select>
              </div>
              <div class="osa-form__group">
                <label>Para *</label>
                <select name="to_location" required>
                  ${Object.entries(OSA_CONFIG.LOCATIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
                </select>
              </div>
            </div>

            <div class="osa-form__group">
              <label>Nota</label>
              <textarea name="note" rows="2"></textarea>
            </div>

            <div id="transfer-items-list">
              <h4>Produtos</h4>
              <div class="transfer-item-row" data-idx="0">
                <select name="product_0" class="osa-form__select--product">
                  <option value="">Selecione</option>
                  ${products.map(p => `<option value="${p.id}">${OSA_UI.escapeHtml(p.name)}</option>`).join('')}
                </select>
                <input type="number" name="qty_0" min="1" value="1" class="osa-form__input--qty" placeholder="Qtd">
              </div>
            </div>

            <button type="button" class="osa-btn osa-btn--outline" onclick="OSA_TRANSFERS.addItem()">+ Adicionar Produto</button>

            <div class="osa-form__actions">
              <button type="submit" class="osa-btn osa-btn--primary">Processar Transferência</button>
              <button type="button" class="osa-btn osa-btn--secondary" onclick="OSA_TRANSFERS.renderList('module-content')">Cancelar</button>
            </div>
          </form>
        </div>
      </div>`;

    let itemCounter = 1;

    window.OSA_TRANSFERS.addItem = () => {
      const list = document.getElementById('transfer-items-list');
      const idx = itemCounter++;
      const row = document.createElement('div');
      row.className = 'transfer-item-row';
      row.dataset.idx = idx;
      row.innerHTML = `
        <select name="product_${idx}" class="osa-form__select--product">
          <option value="">Selecione</option>
          ${products.map(p => `<option value="${p.id}">${OSA_UI.escapeHtml(p.name)}</option>`).join('')}
        </select>
        <input type="number" name="qty_${idx}" min="1" value="1" class="osa-form__input--qty" placeholder="Qtd">
        <button type="button" class="osa-btn osa-btn--sm osa-btn--danger" onclick="this.parentElement.remove()">×</button>
      `;
      list.appendChild(row);
    };

    document.getElementById('transfer-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);

      const fromLocation = fd.get('from_location');
      const toLocation = fd.get('to_location');

      if (fromLocation === toLocation) {
        OSA_UI.notifyError('Origem e destino não podem ser iguais');
        return;
      }

      const items = [];
      const rows = document.querySelectorAll('.transfer-item-row');
      rows.forEach(row => {
        const idx = row.dataset.idx;
        const productId = fd.get(`product_${idx}`);
        const qty = parseInt(fd.get(`qty_${idx}`));
        if (productId && qty > 0) {
          items.push({ product_id: productId, quantity: qty });
        }
      });

      if (!items.length) {
        OSA_UI.notifyError('Adicione pelo menos um produto');
        return;
      }

      const btn = e.target.querySelector('[type=submit]');
      OSA_UI.setButtonLoading(btn, true);

      await processTransfer({
        from_location: fromLocation,
        to_location: toLocation,
        items,
        note: fd.get('note')
      });

      OSA_UI.setButtonLoading(btn, false);
      renderList('module-content');
    };
  }

  // --- View transfer detail ---

  async function viewDetail(id) {
    const transferRes = await get(id);
    if (!transferRes.ok) { OSA_UI.showError('Transferência não encontrada', transferRes); return; }

    const itemsRes = await getItems(id);
    const items = itemsRes.ok ? (itemsRes.data || []) : [];

    const t = transferRes.data;

    const content = `
      <div class="osa-card">
        <div class="osa-card__header"><h3>Transferência ${OSA_UI.escapeHtml(t.reference || '')}</h3></div>
        <div class="osa-card__body">
          <div class="osa-detail-grid">
            <div><strong>De:</strong> ${OSA_CONFIG.LOCATIONS[t.from_location] || t.from_location}</div>
            <div><strong>Para:</strong> ${OSA_CONFIG.LOCATIONS[t.to_location] || t.to_location}</div>
            <div><strong>Data:</strong> ${OSA_UI.formatDateTime(t.created_at)}</div>
            <div><strong>Status:</strong> ${OSA_UI.escapeHtml(t.status)}</div>
            <div><strong>Nota:</strong> ${OSA_UI.escapeHtml(t.note || '—')}</div>
          </div>
          <table class="osa-table osa-table--compact"><thead><tr><th>Produto</th><th>Quantidade</th></tr></thead><tbody>
          ${items.map(i => `<tr><td>${OSA_UI.escapeHtml(i.product_name || i.product_id)}</td><td class="osa-td--number">${OSA_UI.formatNumber(i.quantity)}</td></tr>`).join('')}
          </tbody></table>
          <div class="osa-form__actions">
            <button class="osa-btn osa-btn--primary" onclick="OSA_TRANSFERS.printReceipt('${id}')">Imprimir Recibo</button>
            <button class="osa-btn osa-btn--secondary" onclick="OSA_TRANSFERS.renderList('module-content')">Voltar</button>
          </div>
        </div>
      </div>`;

    document.getElementById('module-content').innerHTML = content;
  }

  async function printReceipt(id) {
    const transferRes = await get(id);
    const itemsRes = await getItems(id);
    const configs = await OSA_DATA.read('configs', { single: true, filter: { column: 'key', value: 'store' } });

    if (!transferRes.ok) return;

    const storeConfig = configs.ok ? configs.data?.value : null;
    const items = itemsRes.ok ? (itemsRes.data || []) : [];
    const receipt = OSA_UI.generateTransferReceiptHTML(transferRes.data, items, storeConfig);
    OSA_UI.printReceipt(receipt);
  }

  return { list, get, getItems, processTransfer, renderList, renderForm, viewDetail, printReceipt };
})();
