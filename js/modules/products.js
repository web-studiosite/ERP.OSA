/**
 * OSA — Products Module
 */

const OSA_PRODUCTS = (() => {

  async function list(filters = {}) {
    const opts = { order: { column: 'name', ascending: true } };
    if (filters.category_id) opts.filters = [{ column: 'category_id', operator: 'eq', value: filters.category_id }];
    if (filters.active !== undefined) {
      opts.filters = opts.filters || [];
      opts.filters.push({ column: 'is_active', operator: 'eq', value: filters.active });
    }
    if (filters.search) {
      opts.filters = opts.filters || [];
      opts.filters.push({ column: 'name', operator: 'ilike', value: `%${filters.search}%` });
    }
    return OSA_DATA.read('products', opts);
  }

  async function get(id) {
    return OSA_DATA.read('products', { single: true, filter: { column: 'id', value: id } });
  }

  async function create(productData) {
    const userId = OSA_AUTH.getCurrentUser()?.id;
    const record = {
      name: productData.name,
      code: productData.code || null,
      barcode: productData.barcode || null,
      category_id: productData.category_id || null,
      unit: productData.unit || 'unit',
      cost_price: productData.cost_price || 0,
      sale_price: productData.sale_price || 0,
      price_method: productData.price_method || 'fixed',
      min_stock: productData.min_stock || 0,
      is_active: productData.is_active !== false,
      created_by: userId
    };

    const res = await OSA_DATA.create('products', record);
    if (res.ok) {
      await OSA_DATA.audit('CREATE', 'products', res.data.id, null, res.data);
      OSA_UI.notifySuccess('Produto criado com sucesso');
    } else {
      OSA_UI.showError('Erro ao criar produto', res);
    }
    return res;
  }

  async function update(id, updates) {
    const oldRes = await get(id);
    if (!oldRes.ok) { OSA_UI.showError('Produto não encontrado', oldRes); return oldRes; }

    const res = await OSA_DATA.update('products', id, updates);
    if (res.ok) {
      await OSA_DATA.audit('UPDATE', 'products', id, oldRes.data, res.data);
      OSA_UI.notifySuccess('Produto atualizado');
    } else {
      OSA_UI.showError('Erro ao atualizar produto', res);
    }
    return res;
  }

  async function deactivate(id) {
    return update(id, { is_active: false });
  }

  async function activate(id) {
    return update(id, { is_active: true });
  }

  // --- Render products list ---

  function renderList(containerId, filters = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    OSA_UI.setLoading(containerId, true);

    list(filters).then(res => {
      if (!res.ok) {
        container.innerHTML = `<div class="osa-alert osa-alert--error">${OSA_UI.escapeHtml(res.error)}</div>`;
        return;
      }

      const items = res.data || [];
      if (!items.length) {
        container.innerHTML = OSA_UI.emptyState('Nenhum produto encontrado');
        return;
      }

      let html = `<table class="osa-table"><thead><tr>
        <th>Código</th><th>Nome</th><th>Categoria</th><th>Preço Custo</th><th>Preço Venda</th><th>Estado</th><th>Ações</th>
      </tr></thead><tbody>`;

      items.forEach(p => {
        html += `<tr>
          <td><code>${OSA_UI.escapeHtml(p.code || '')}</code></td>
          <td>${OSA_UI.escapeHtml(p.name)}</td>
          <td>${OSA_UI.escapeHtml(p.category_name || '')}</td>
          <td class="osa-td--number">${OSA_AUTH.canSeeCosts() ? OSA_UI.formatCurrency(p.cost_price) : '—'}</td>
          <td class="osa-td--number">${OSA_UI.formatCurrency(p.sale_price)}</td>
          <td><span class="osa-badge ${p.is_active ? 'osa-badge--success' : 'osa-badge--secondary'}">${p.is_active ? 'Ativo' : 'Inativo'}</span></td>
          <td>
            <button class="osa-btn osa-btn--sm osa-btn--outline" onclick="OSA_PRODUCTS.editForm('${p.id}')">Editar</button>
            <button class="osa-btn osa-btn--sm ${p.is_active ? 'osa-btn--danger' : 'osa-btn--success'}" onclick="OSA_PRODUCTS.toggleActive('${p.id}', ${!p.is_active})">
              ${p.is_active ? 'Desativar' : 'Ativar'}
            </button>
          </td>
        </tr>`;
      });

      html += '</tbody></table>';
      container.innerHTML = html;
    });
  }

  // --- Product form (create/edit) ---

  async function renderForm(containerId, productId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let product = {};
    if (productId) {
      const res = await get(productId);
      if (!res.ok) { container.innerHTML = OSA_UI.emptyState('Produto não encontrado'); return; }
      product = res.data;
    }

    // Load categories for dropdown
    const catRes = await OSA_DATA.read('categories', { order: { column: 'name', ascending: true } });
    const categories = catRes.ok ? (catRes.data || []) : [];

    const isEdit = !!productId;
    const title = isEdit ? 'Editar Produto' : 'Novo Produto';

    container.innerHTML = `
      <div class="osa-card">
        <div class="osa-card__header"><h3>${title}</h3></div>
        <div class="osa-card__body">
          <form id="product-form" class="osa-form">
            <div class="osa-form__row">
              <div class="osa-form__group">
                <label>Nome *</label>
                <input type="text" name="name" value="${OSA_UI.escapeHtml(product.name || '')}" required>
              </div>
              <div class="osa-form__group">
                <label>Código</label>
                <input type="text" name="code" value="${OSA_UI.escapeHtml(product.code || '')}">
              </div>
            </div>
            <div class="osa-form__row">
              <div class="osa-form__group">
                <label>Código de Barras</label>
                <input type="text" name="barcode" value="${OSA_UI.escapeHtml(product.barcode || '')}">
              </div>
              <div class="osa-form__group">
                <label>Categoria</label>
                <select name="category_id">
                  <option value="">— Sem categoria —</option>
                  ${categories.map(c => `<option value="${c.id}" ${product.category_id === c.id ? 'selected' : ''}>${OSA_UI.escapeHtml(c.name)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="osa-form__row">
              <div class="osa-form__group">
                <label>Unidade</label>
                <select name="unit">
                  <option value="unit" ${product.unit === 'unit' ? 'selected' : ''}>Unidade</option>
                  <option value="kg" ${product.unit === 'kg' ? 'selected' : ''}>Kg</option>
                  <option value="l" ${product.unit === 'l' ? 'selected' : ''}>Litro</option>
                  <option value="m" ${product.unit === 'm' ? 'selected' : ''}>Metro</option>
                  <option value="pack" ${product.unit === 'pack' ? 'selected' : ''}>Pacote</option>
                </select>
              </div>
              <div class="osa-form__group">
                <label>Preço Custo (MZN)${OSA_AUTH.canSeeCosts() ? ' *' : ''}</label>
                <input type="number" name="cost_price" step="0.01" min="0" value="${product.cost_price || 0}" ${OSA_AUTH.canSeeCosts() ? '' : 'readonly class="osa-input--readonly"'}>
              </div>
            </div>
            <div class="osa-form__row">
              <div class="osa-form__group">
                <label>Preço Venda (MZN) *</label>
                <input type="number" name="sale_price" step="0.01" min="0" value="${product.sale_price || 0}" required>
              </div>
              <div class="osa-form__group">
                <label>Método de Preço</label>
                <select name="price_method">
                  ${Object.entries(OSA_CONFIG.PRICE_METHODS).map(([k, v]) => `<option value="${k}" ${product.price_method === k ? 'selected' : ''}>${OSA_UI.escapeHtml(v)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="osa-form__row">
              <div class="osa-form__group">
                <label>Stock Mínimo</label>
                <input type="number" name="min_stock" min="0" value="${product.min_stock || 0}">
              </div>
              <div class="osa-form__group">
                <label>Ativo</label>
                <select name="is_active">
                  <option value="true" ${product.is_active !== false ? 'selected' : ''}>Sim</option>
                  <option value="false" ${product.is_active === false ? 'selected' : ''}>Não</option>
                </select>
              </div>
            </div>
            <div class="osa-form__actions">
              <button type="submit" class="osa-btn osa-btn--primary">${isEdit ? 'Guardar Alterações' : 'Criar Produto'}</button>
              <button type="button" class="osa-btn osa-btn--secondary" onclick="OSA_NAV.navigate('products')">Cancelar</button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.getElementById('product-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = {
        name: fd.get('name'),
        code: fd.get('code') || null,
        barcode: fd.get('barcode') || null,
        category_id: fd.get('category_id') || null,
        unit: fd.get('unit'),
        cost_price: parseFloat(fd.get('cost_price')) || 0,
        sale_price: parseFloat(fd.get('sale_price')) || 0,
        price_method: fd.get('price_method'),
        min_stock: parseInt(fd.get('min_stock')) || 0,
        is_active: fd.get('is_active') === 'true'
      };

      const btn = e.target.querySelector('[type=submit]');
      OSA_UI.setButtonLoading(btn, true);

      if (isEdit) {
        await update(productId, data);
      } else {
        await create(data);
      }

      OSA_UI.setButtonLoading(btn, false);
      OSA_NAV.navigate('products');
    };
  }

  async function toggleActive(id, active) {
    OSA_UI.confirm(
      active ? 'Ativar este produto?' : 'Desativar este produto?',
      async () => {
        if (active) await activate(id); else await deactivate(id);
        renderList('module-content');
      },
      { danger: !active }
    );
  }

  async function editForm(id) {
    renderForm('module-content', id);
  }

  return {
    list,
    get,
    create,
    update,
    deactivate,
    activate,
    renderList,
    renderForm,
    editForm,
    toggleActive
  };
})();
