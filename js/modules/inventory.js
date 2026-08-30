/**
 * OSA — Inventory Count Module
 */

const OSA_INVENTORY = (() => {

  async function list() {
    return OSA_DATA.read('inventories', { order: { column: 'created_at', ascending: false } });
  }

  async function get(id) {
    return OSA_DATA.read('inventories', { single: true, filter: { column: 'id', value: id } });
  }

  async function getItems(inventoryId) {
    return OSA_DATA.read('inventory_items', {
      filters: [{ column: 'inventory_id', operator: 'eq', value: inventoryId }],
      order: { column: 'product_name', ascending: true }
    });
  }

  async function create(data) {
    const userId = OSA_AUTH.getCurrentUser()?.id;
    const record = {
      location: data.location,
      status: data.status || 'in_progress',
      started_by: userId,
      note: data.note || null
    };

    const res = await OSA_DATA.create('inventories', record);
    if (res.ok) {
      await OSA_DATA.audit('CREATE', 'inventories', res.data.id, null, res.data);
      OSA_UI.notifySuccess('Inventário criado');
    } else {
      OSA_UI.showError('Erro ao criar inventário', res);
    }
    return res;
  }

  async function addItem(inventoryId, itemData) {
    const record = {
      inventory_id: inventoryId,
      product_id: itemData.product_id,
      product_name: itemData.product_name || '',
      system_qty: itemData.system_qty || 0,
      counted_qty: itemData.counted_qty,
      difference: (itemData.counted_qty || 0) - (itemData.system_qty || 0),
      counted_by: OSA_AUTH.getCurrentUser()?.id
    };

    return OSA_DATA.create('inventory_items', record);
  }

  async function completeInventory(inventoryId) {
    const res = await OSA_DATA.update('inventories', inventoryId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      completed_by: OSA_AUTH.getCurrentUser()?.id
    });

    if (res.ok) {
      // Register adjustments for differences
      const itemsRes = await getItems(inventoryId);
      if (itemsRes.ok) {
        const items = itemsRes.data || [];
        for (const item of items) {
          if (item.difference !== 0) {
            await OSA_STOCK.registerAdjustment({
              product_id: item.product_id,
              quantity: item.difference,
              location: res.data.location,
              note: `Ajuste de inventário #${inventoryId.substring(0, 8)}`
            });
          }
        }
      }

      await OSA_DATA.audit('UPDATE', 'inventories', inventoryId, null, res.data);
      OSA_UI.notifySuccess('Inventário finalizado — ajustes aplicados');
    } else {
      OSA_UI.showError('Erro ao finalizar inventário', res);
    }
    return res;
  }

  // --- Render inventory list ---

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
            <h3>Inventários</h3>
            ${OSA_AUTH.isJuniorAdminOrAbove() ? '<button class="osa-btn osa-btn--primary" onclick="OSA_INVENTORY.renderForm(\'module-content\')">+ Novo Inventário</button>' : ''}
          </div>
          <div class="osa-card__body">`;

      if (!items.length) {
        html += OSA_UI.emptyState('Nenhum inventário registado');
      } else {
        html += `<table class="osa-table"><thead><tr><th>Local</th><th>Status</th><th>Iniciado</th><th>Finalizado</th><th>Ações</th></tr></thead><tbody>`;

        items.forEach(inv => {
          const statusBadge = {
            in_progress: 'osa-badge--warning',
            completed: 'osa-badge--success',
            cancelled: 'osa-badge--danger'
          }[inv.status] || 'osa-badge--secondary';

          html += `<tr>
            <td>${OSA_CONFIG.LOCATIONS[inv.location] || inv.location}</td>
            <td><span class="osa-badge ${statusBadge}">${OSA_UI.escapeHtml(inv.status)}</span></td>
            <td>${OSA_UI.formatDateTime(inv.created_at)}</td>
            <td>${inv.completed_at ? OSA_UI.formatDateTime(inv.completed_at) : '—'}</td>
            <td>
              <button class="osa-btn osa-btn--sm osa-btn--outline" onclick="OSA_INVENTORY.viewDetail('${inv.id}')">Ver</button>
              ${inv.status === 'in_progress' ? `<button class="osa-btn osa-btn--sm osa-btn--success" onclick="OSA_INVENTORY.completeInventoryUI('${inv.id}')">Finalizar</button>` : ''}
            </td>
          </tr>`;
        });

        html += '</tbody></table>';
      }

      html += '</div></div>';
      container.innerHTML = html;
    });
  }

  // --- New inventory form ---

  async function renderForm(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
      <div class="osa-card">
        <div class="osa-card__header"><h3>Novo Inventário</h3></div>
        <div class="osa-card__body">
          <form id="inventory-form" class="osa-form">
            <div class="osa-form__group">
              <label>Local *</label>
              <select name="location" required>
                ${Object.entries(OSA_CONFIG.LOCATIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
              </select>
            </div>
            <div class="osa-form__group">
              <label>Nota</label>
              <textarea name="note" rows="2"></textarea>
            </div>
            <div class="osa-form__actions">
              <button type="submit" class="osa-btn osa-btn--primary">Criar Inventário</button>
              <button type="button" class="osa-btn osa-btn--secondary" onclick="OSA_INVENTORY.renderList('module-content')">Cancelar</button>
            </div>
          </form>
        </div>
      </div>`;

    document.getElementById('inventory-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);

      const btn = e.target.querySelector('[type=submit]');
      OSA_UI.setButtonLoading(btn, true);

      const res = await create({ location: fd.get('location'), note: fd.get('note') });

      OSA_UI.setButtonLoading(btn, false);
      if (res.ok) viewDetail(res.data.id);
    };
  }

  // --- View inventory detail + count items ---

  async function viewDetail(inventoryId) {
    const invRes = await get(inventoryId);
    if (!invRes.ok) { OSA_UI.showError('Inventário não encontrado', invRes); return; }

    const itemsRes = await getItems(inventoryId);
    const items = itemsRes.ok ? (itemsRes.data || []) : [];

    const inv = invRes.data;
    const isInProgress = inv.status === 'in_progress';

    // Load products for counting
    let productsOpts = '';
    if (isInProgress) {
      const productsRes = await OSA_DATA.read('products', {
        filters: [{ column: 'is_active', operator: 'eq', value: true }],
        order: { column: 'name', ascending: true }
      });
      const products = productsRes.ok ? (productsRes.data || []) : [];
      productsOpts = products.map(p => `<option value="${p.id}">${OSA_UI.escapeHtml(p.name)}</option>`).join('');
    }

    const container = document.getElementById('module-content');
    container.innerHTML = `
      <div class="osa-card">
        <div class="osa-card__header osa-card__header--actions">
          <h3>Inventário — ${OSA_CONFIG.LOCATIONS[inv.location] || inv.location}</h3>
          ${isInProgress ? '<button class="osa-btn osa-btn--success" onclick="OSA_INVENTORY.completeInventoryUI(\''+inventoryId+'\')">Finalizar Inventário</button>' : ''}
        </div>
        <div class="osa-card__body">
          <div class="osa-detail-grid">
            <div><strong>Status:</strong> <span class="osa-badge ${inv.status === 'completed' ? 'osa-badge--success' : 'osa-badge--warning'}">${inv.status}</span></div>
            <div><strong>Iniciado:</strong> ${OSA_UI.formatDateTime(inv.created_at)}</div>
            <div><strong>Nota:</strong> ${OSA_UI.escapeHtml(inv.note || '—')}</div>
          </div>

          ${isInProgress ? `
          <form id="inventory-count-form" class="osa-form" style="margin-top:1rem">
            <div class="osa-form__row">
              <div class="osa-form__group">
                <label>Produto</label>
                <select name="product_id" id="inv-count-product" required>
                  <option value="">Selecione</option>
                  ${productsOpts}
                </select>
              </div>
              <div class="osa-form__group">
                <label>Qtd. Sistema</label>
                <input type="number" name="system_qty" id="inv-system-qty" min="0" value="0" readonly>
              </div>
              <div class="osa-form__group">
                <label>Qtd. Contada *</label>
                <input type="number" name="counted_qty" min="0" value="0" required>
              </div>
            </div>
            <button type="submit" class="osa-btn osa-btn--primary">Registar Contagem</button>
          </form>` : ''}

          <div id="inventory-items-table" style="margin-top:1.5rem"></div>
        </div>
      </div>`;

    // Render items table
    renderItemsTable('inventory-items-table', inventoryId, items);

    if (isInProgress) {
      // Auto-fill system qty when product selected
      document.getElementById('inv-count-product').onchange = async function() {
        const productId = this.value;
        if (!productId) return;
        const balanceRes = await OSA_STOCK.getBalance(productId, inv.location);
        document.getElementById('inv-system-qty').value = balanceRes.ok ? (balanceRes.data || 0) : 0;
      };

      document.getElementById('inventory-count-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);

        const productName = document.getElementById('inv-count-product').selectedOptions[0]?.text || '';

        const btn = e.target.querySelector('[type=submit]');
        OSA_UI.setButtonLoading(btn, true);

        const res = await addItem(inventoryId, {
          product_id: fd.get('product_id'),
          product_name: productName,
          system_qty: parseInt(fd.get('system_qty')) || 0,
          counted_qty: parseInt(fd.get('counted_qty')) || 0
        });

        OSA_UI.setButtonLoading(btn, false);

        if (res.ok) {
          OSA_UI.notifySuccess('Contagem registada');
          viewDetail(inventoryId); // refresh
        } else {
          OSA_UI.showError('Erro ao registar', res);
        }
      };
    }
  }

  function renderItemsTable(containerId, inventoryId, items) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!items.length) {
      container.innerHTML = OSA_UI.emptyState('Nenhum item contado');
      return;
    }

    let html = `<table class="osa-table"><thead><tr><th>Produto</th><th>Qtd. Sistema</th><th>Qtd. Contada</th><th>Diferença</th></tr></thead><tbody>`;

    items.forEach(i => {
      const diffClass = i.difference > 0 ? 'osa-td--success' : i.difference < 0 ? 'osa-td--danger' : '';
      html += `<tr>
        <td>${OSA_UI.escapeHtml(i.product_name)}</td>
        <td class="osa-td--number">${OSA_UI.formatNumber(i.system_qty)}</td>
        <td class="osa-td--number">${OSA_UI.formatNumber(i.counted_qty)}</td>
        <td class="osa-td--number ${diffClass}">${i.difference > 0 ? '+' : ''}${OSA_UI.formatNumber(i.difference)}</td>
      </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function completeInventoryUI(inventoryId) {
    OSA_UI.confirm(
      'Finalizar inventário? Ajustes de stock serão aplicados automaticamente para as diferenças encontradas.',
      async () => {
        await completeInventory(inventoryId);
        renderList('module-content');
      },
      { danger: true, title: 'Finalizar Inventário', confirmText: 'Finalizar' }
    );
  }

  return { list, get, getItems, create, addItem, completeInventory, renderList, renderForm, viewDetail, completeInventoryUI };
})();
