/**
 * OSA — Stock Module
 * Stock balance calculation from movements (single source of truth)
 */

const OSA_STOCK = (() => {

  // --- Get stock balance for a product at a location via DB function ---

  async function getBalance(productId, location) {
    const res = await OSA_DATA.rpc('get_stock_balance', {
      p_product_id: productId,
      p_location: location
    });
    return res;
  }

  // --- Get all stock for warehouse view ---

  async function getWarehouseStock() {
    return OSA_DATA.read('v_stock_warehouse', { order: { column: 'product_name', ascending: true } });
  }

  // --- Get all stock for store view ---

  async function getStoreStock() {
    return OSA_DATA.read('v_stock_store', { order: { column: 'product_name', ascending: true } });
  }

  // --- Get stock movements for a product ---

  async function getProductMovements(productId, limit = 50) {
    return OSA_DATA.read('stock_movements', {
      filters: [{ column: 'product_id', operator: 'eq', value: productId }],
      order: { column: 'created_at', ascending: false },
      limit
    });
  }

  // --- Get all recent movements ---

  async function getRecentMovements(limit = 50) {
    return OSA_DATA.read('stock_movements', {
      order: { column: 'created_at', ascending: false },
      limit
    });
  }

  // --- Register a stock movement (purchase in, adjustment, etc.) ---

  async function registerMovement(movementData) {
    // movementData: { product_id, movement_type, quantity, location, unit_cost, total_cost, note, reference }
    const userId = OSA_AUTH.getCurrentUser()?.id;

    const record = {
      product_id: movementData.product_id,
      movement_type: movementData.movement_type,
      quantity: movementData.quantity,
      location: movementData.location,
      unit_cost: movementData.unit_cost || null,
      total_cost: movementData.total_cost || null,
      note: movementData.note || null,
      reference: movementData.reference || null,
      created_by: userId
    };

    const res = await OSA_DATA.create('stock_movements', record);

    if (res.ok) {
      await OSA_DATA.audit('CREATE', 'stock_movements', res.data.id, null, res.data);
      OSA_UI.notifySuccess('Movimentação registada com sucesso');

      // Generate receipt
      const configs = await OSA_DATA.read('configs', { single: true, filter: { column: 'key', value: 'store' } });
      const storeConfig = configs.ok ? configs.data?.value : null;
      const receipt = OSA_UI.generateMovementReceiptHTML(res.data, storeConfig);
      OSA_UI.printReceipt(receipt);
    } else {
      OSA_UI.showError('Erro ao registar movimentação', res);
    }

    return res;
  }

  // --- Purchase (stock in to warehouse) ---

  async function registerPurchase(data) {
    return registerMovement({
      ...data,
      movement_type: 'purchase',
      location: data.location || 'warehouse'
    });
  }

  // --- Adjustment (manual correction) ---

  async function registerAdjustment(data) {
    // quantity positive = add, negative = subtract
    return registerMovement({
      ...data,
      movement_type: 'adjustment'
    });
  }

  // --- Render warehouse stock table ---

  function renderWarehouseTable(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    OSA_UI.setLoading(containerId, true);

    getWarehouseStock().then(res => {
      if (!res.ok) {
        container.innerHTML = `<div class="osa-alert osa-alert--error">Erro ao carregar stock: ${OSA_UI.escapeHtml(res.error)}</div>`;
        return;
      }

      const items = res.data || [];
      if (!items.length) {
        container.innerHTML = OSA_UI.emptyState('Nenhum produto em armazém');
        return;
      }

      let html = `<table class="osa-table"><thead><tr>
        <th>Produto</th><th>Código</th><th>Quantidade</th><th>Custo Médio</th><th>Valor Total</th>
      </tr></thead><tbody>`;

      let totalValue = 0;

      items.forEach(item => {
        const totalItemValue = (item.avg_cost || 0) * (item.quantity || 0);
        totalValue += totalItemValue;
        html += `<tr>
          <td>${OSA_UI.escapeHtml(item.product_name)}</td>
          <td><code>${OSA_UI.escapeHtml(item.product_code || '')}</code></td>
          <td class="osa-td--number ${item.quantity <= 0 ? 'osa-td--danger' : ''}">${OSA_UI.formatNumber(item.quantity)}</td>
          <td class="osa-td--number">${OSA_AUTH.canSeeCosts() ? OSA_UI.formatCurrency(item.avg_cost || 0) : '—'}</td>
          <td class="osa-td--number">${OSA_AUTH.canSeeCosts() ? OSA_UI.formatCurrency(totalItemValue) : '—'}</td>
        </tr>`;
      });

      html += `</tbody><tfoot><tr><td colspan="4"><strong>Valor Total em Armazém</strong></td><td class="osa-td--number"><strong>${OSA_AUTH.canSeeCosts() ? OSA_UI.formatCurrency(totalValue) : '—'}</strong></td></tr></tfoot></table>`;

      container.innerHTML = html;
    });
  }

  // --- Render store stock table ---

  function renderStoreTable(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    OSA_UI.setLoading(containerId, true);

    getStoreStock().then(res => {
      if (!res.ok) {
        container.innerHTML = `<div class="osa-alert osa-alert--error">Erro ao carregar stock: ${OSA_UI.escapeHtml(res.error)}</div>`;
        return;
      }

      const items = res.data || [];
      if (!items.length) {
        container.innerHTML = OSA_UI.emptyState('Nenhum produto na loja');
        return;
      }

      let html = `<table class="osa-table"><thead><tr>
        <th>Produto</th><th>Código</th><th>Quantidade</th>
      </tr></thead><tbody>`;

      items.forEach(item => {
        html += `<tr>
          <td>${OSA_UI.escapeHtml(item.product_name)}</td>
          <td><code>${OSA_UI.escapeHtml(item.product_code || '')}</code></td>
          <td class="osa-td--number ${item.quantity <= 0 ? 'osa-td--danger' : ''}">${OSA_UI.formatNumber(item.quantity)}</td>
        </tr>`;
      });

      html += '</tbody></table>';

      container.innerHTML = html;
    });
  }

  // --- Render product movement history ---

  function renderMovementHistory(containerId, productId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    OSA_UI.setLoading(containerId, true);

    getProductMovements(productId).then(res => {
      if (!res.ok) {
        container.innerHTML = `<div class="osa-alert osa-alert--error">${OSA_UI.escapeHtml(res.error)}</div>`;
        return;
      }

      const items = res.data || [];
      if (!items.length) {
        container.innerHTML = OSA_UI.emptyState('Sem movimentações para este produto');
        return;
      }

      let html = `<table class="osa-table osa-table--compact"><thead><tr>
        <th>Data</th><th>Tipo</th><th>Qtd</th><th>Local</th><th>Nota</th>
      </tr></thead><tbody>`;

      items.forEach(m => {
        const typeLabel = OSA_CONFIG.MOVEMENT_TYPES[m.movement_type] || m.movement_type;
        const isNegative = ['sale', 'transfer_out', 'loss', 'theft', 'return_to_supplier'].includes(m.movement_type);
        html += `<tr>
          <td>${OSA_UI.formatDateTime(m.created_at)}</td>
          <td><span class="osa-badge ${isNegative ? 'osa-badge--danger' : 'osa-badge--success'}">${OSA_UI.escapeHtml(typeLabel)}</span></td>
          <td class="osa-td--number ${isNegative ? 'osa-td--danger' : 'osa-td--success'}">${isNegative ? '' : '+'}${OSA_UI.formatNumber(m.quantity)}</td>
          <td>${OSA_CONFIG.LOCATIONS[m.location] || m.location}</td>
          <td>${OSA_UI.escapeHtml(m.note || '')}</td>
        </tr>`;
      });

      html += '</tbody></table>';
      container.innerHTML = html;
    });
  }

  return {
    getBalance,
    getWarehouseStock,
    getStoreStock,
    getProductMovements,
    getRecentMovements,
    registerMovement,
    registerPurchase,
    registerAdjustment,
    renderWarehouseTable,
    renderStoreTable,
    renderMovementHistory
  };
})();
