/**
 * OSA — Sales Module
 * Uses process_sale PostgreSQL function for atomic transaction
 */

const OSA_SALES = (() => {

  // Cart state
  let cart = [];
  let customerName = '';
  let customerPhone = '';
  let paymentMethod = 'cash';
  let discountAmount = 0;

  function resetCart() {
    cart = [];
    customerName = '';
    customerPhone = '';
    paymentMethod = 'cash';
    discountAmount = 0;
    renderCart('cart-area');
  }

  function addToCart(product, quantity = 1) {
    const existing = cart.find(i => i.product_id === product.id);
    if (existing) {
      existing.quantity += quantity;
      existing.total = existing.quantity * existing.unit_price;
    } else {
      cart.push({
        product_id: product.id,
        product_name: product.name,
        product_code: product.code || '',
        unit_price: product.sale_price,
        cost_price: product.cost_price,
        quantity,
        total: quantity * product.sale_price,
        price_method: product.price_method
      });
    }
    renderCart('cart-area');
  }

  function removeFromCart(productId) {
    cart = cart.filter(i => i.product_id !== productId);
    renderCart('cart-area');
  }

  function updateCartQty(productId, qty) {
    const item = cart.find(i => i.product_id === productId);
    if (item) {
      item.quantity = Math.max(1, qty);
      item.total = item.quantity * item.unit_price;
      renderCart('cart-area');
    }
  }

  function updateCartPrice(productId, price) {
    const item = cart.find(i => i.product_id === productId);
    if (item && item.price_method === 'negotiable') {
      item.unit_price = Math.max(0, price);
      item.total = item.quantity * item.unit_price;
      renderCart('cart-area');
    }
  }

  function getCartTotal() {
    return cart.reduce((sum, i) => sum + i.total, 0);
  }

  function getCartSubtotal() {
    return getCartTotal() + discountAmount;
  }

  // --- Process sale via PostgreSQL function ---

  async function processSale() {
    if (!cart.length) {
      OSA_UI.notifyError('Adicione produtos ao carrinho');
      return null;
    }

    const userId = OSA_AUTH.getCurrentUser()?.id;

    const saleData = {
      p_customer_name: customerName || null,
      p_customer_phone: customerPhone || null,
      p_payment_method: paymentMethod,
      p_discount: discountAmount,
      p_items: cart.map(i => ({
        product_id: i.product_id,
        quantity: i.quantity,
        unit_price: i.unit_price,
        cost_price: i.cost_price,
        price_method: i.price_method
      })),
      p_created_by: userId
    };

    const res = await OSA_DATA.rpc('process_sale', saleData);

    if (res.ok) {
      await OSA_DATA.audit('CREATE', 'sales', res.data?.id, null, res.data);

      // Generate receipt
      const configs = await OSA_DATA.read('configs', { single: true, filter: { column: 'key', value: 'store' } });
      const storeConfig = configs.ok ? configs.data?.value : null;

      const sale = {
        ...res.data,
        total: res.data?.total || getCartTotal(),
        discount: discountAmount,
        payment_method: paymentMethod,
        created_at: new Date().toISOString(),
        reference: res.data?.reference
      };

      const receiptHTML = OSA_UI.generateReceiptHTML(sale, cart, storeConfig);
      OSA_UI.printReceipt(receiptHTML);

      OSA_UI.notifySuccess(`Venda registada! Ref: ${res.data?.reference || ''}`);
      resetCart();
    } else {
      OSA_UI.showError('Erro ao processar venda', res);
    }

    return res;
  }

  // --- Sales history ---

  async function listHistory(filters = {}) {
    const opts = { order: { column: 'created_at', ascending: false } };

    if (filters.dateRange) {
      opts.dateRange = filters.dateRange;
    }

    return OSA_DATA.read('sales', opts);
  }

  async function getSale(id) {
    return OSA_DATA.read('sales', { single: true, filter: { column: 'id', value: id } });
  }

  async function getSaleItems(saleId) {
    return OSA_DATA.read('sale_items', {
      filters: [{ column: 'sale_id', operator: 'eq', value: saleId }]
    });
  }

  // --- Render POS interface ---

  async function renderPOS(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const productsRes = await OSA_DATA.read('products', {
      filters: [{ column: 'is_active', operator: 'eq', value: true }],
      order: { column: 'name', ascending: true }
    });
    const products = productsRes.ok ? (productsRes.data || []) : [];

    container.innerHTML = `
      <div class="osa-pos">
        <div class="osa-pos__products">
          <div class="osa-pos__search">
            <input type="text" id="pos-search" placeholder="Pesquisar produto..." oninput="OSA_SALES.filterProducts(this.value)">
          </div>
          <div class="osa-pos__grid" id="pos-products-grid">
            ${products.map(p => `
              <div class="osa-pos__card" onclick="OSA_SALES.addToCart(${JSON.stringify(p).replace(/"/g, '&quot;')})">
                <div class="osa-pos__card-name">${OSA_UI.escapeHtml(p.name)}</div>
                <div class="osa-pos__card-price">${OSA_UI.formatCurrency(p.sale_price)}</div>
                <div class="osa-pos__card-code">${OSA_UI.escapeHtml(p.code || '')}</div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="osa-pos__cart" id="cart-area">
          <!-- Cart rendered here -->
        </div>
      </div>
    `;

    renderCart('cart-area');
  }

  function filterProducts(query) {
    const grid = document.getElementById('pos-products-grid');
    if (!grid) return;

    const cards = grid.querySelectorAll('.osa-pos__card');
    const q = query.toLowerCase();

    cards.forEach(card => {
      const name = card.querySelector('.osa-pos__card-name').textContent.toLowerCase();
      const code = card.querySelector('.osa-pos__card-code').textContent.toLowerCase();
      card.style.display = (name.includes(q) || code.includes(q)) ? '' : 'none';
    });
  }

  function renderCart(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const subtotal = getCartSubtotal();
    const total = getCartTotal();

    let html = `
      <div class="osa-cart">
        <div class="osa-cart__header">
          <h3>Carrinho</h3>
          <button class="osa-btn osa-btn--sm osa-btn--danger" onclick="OSA_SALES.resetCart()" ${!cart.length ? 'disabled' : ''}>Limpar</button>
        </div>

        <div class="osa-cart__customer">
          <input type="text" id="cart-customer-name" placeholder="Nome do cliente" value="${OSA_UI.escapeHtml(customerName)}" oninput="OSA_SALES.setCustomerName(this.value)">
          <input type="tel" id="cart-customer-phone" placeholder="Telefone" value="${OSA_UI.escapeHtml(customerPhone)}" oninput="OSA_SALES.setCustomerPhone(this.value)">
        </div>

        <div class="osa-cart__items">
    `;

    if (!cart.length) {
      html += '<div class="osa-cart__empty">Carrinho vazio</div>';
    } else {
      cart.forEach((item, idx) => {
        html += `
          <div class="osa-cart__item">
            <div class="osa-cart__item-info">
              <span class="osa-cart__item-name">${OSA_UI.escapeHtml(item.product_name)}</span>
              <span class="osa-cart__item-price">${OSA_UI.formatCurrency(item.unit_price)}</span>
            </div>
            <div class="osa-cart__item-controls">
              <button class="osa-btn osa-btn--sm" onclick="OSA_SALES.updateCartQty('${item.product_id}', ${item.quantity - 1})" ${item.quantity <= 1 ? 'disabled' : ''}>−</button>
              <span class="osa-cart__item-qty">${item.quantity}</span>
              <button class="osa-btn osa-btn--sm" onclick="OSA_SALES.updateCartQty('${item.product_id}', ${item.quantity + 1})">+</button>
              ${item.price_method === 'negotiable' ? `<input type="number" class="osa-cart__item-price-input" value="${item.unit_price}" step="0.01" onchange="OSA_SALES.updateCartPrice('${item.product_id}', parseFloat(this.value))">` : ''}
            </div>
            <div class="osa-cart__item-total">${OSA_UI.formatCurrency(item.total)}</div>
            <button class="osa-btn osa-btn--sm osa-btn--danger" onclick="OSA_SALES.removeFromCart('${item.product_id}')">×</button>
          </div>
        `;
      });
    }

    html += `
        </div>

        <div class="osa-cart__discount">
          <label>Desconto (MZN)</label>
          <input type="number" id="cart-discount" min="0" step="0.01" value="${discountAmount}" onchange="OSA_SALES.setDiscount(parseFloat(this.value) || 0)">
        </div>

        <div class="osa-cart__totals">
          ${discountAmount > 0 ? `<div class="osa-cart__row"><span>Subtotal</span><span>${OSA_UI.formatCurrency(subtotal)}</span></div>` : ''}
          ${discountAmount > 0 ? `<div class="osa-cart__row"><span>Desconto</span><span>-${OSA_UI.formatCurrency(discountAmount)}</span></div>` : ''}
          <div class="osa-cart__row osa-cart__total"><span>Total</span><span>${OSA_UI.formatCurrency(total)}</span></div>
        </div>

        <div class="osa-cart__payment">
          <label>Método de Pagamento</label>
          <select id="cart-payment" onchange="OSA_SALES.setPaymentMethod(this.value)">
            ${Object.entries(OSA_CONFIG.PAYMENT_METHODS).map(([k, v]) => `<option value="${k}" ${paymentMethod === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </div>

        <button class="osa-btn osa-btn--primary osa-btn--lg osa-btn--block" onclick="OSA_SALES.finalizeSale()" ${!cart.length ? 'disabled' : ''}>
          Finalizar Venda
        </button>
      </div>
    `;

    container.innerHTML = html;
  }

  function setCustomerName(val) { customerName = val; }
  function setCustomerPhone(val) { customerPhone = val; }
  function setPaymentMethod(val) { paymentMethod = val; }
  function setDiscount(val) { discountAmount = Math.max(0, val); renderCart('cart-area'); }

  async function finalizeSale() {
    OSA_UI.confirm(
      `Confirmar venda de ${OSA_UI.formatCurrency(getCartTotal())}?`,
      async () => {
        const res = await processSale();
        if (res?.ok) {
          renderPOS('module-content');
        }
      },
      { title: 'Confirmar Venda', confirmText: 'Confirmar' }
    );
  }

  // --- Render sales history ---

  function renderHistory(containerId, dateFilter = 'last30') {
    const container = document.getElementById(containerId);
    if (!container) return;

    OSA_UI.setLoading(containerId, true);

    const range = OSA_UI.getDateRange(dateFilter);

    listHistory({ dateRange: { column: 'created_at', from: range.from, to: range.to } }).then(res => {
      if (!res.ok) {
        container.innerHTML = `<div class="osa-alert osa-alert--error">${OSA_UI.escapeHtml(res.error)}</div>`;
        return;
      }

      const sales = res.data || [];

      let html = `
        <div class="osa-card">
          <div class="osa-card__header osa-card__header--actions">
            <h3>Histórico de Vendas</h3>
            <div class="osa-filter-group">
              <select id="sales-date-filter" onchange="OSA_SALES.renderHistory('module-content', this.value)">
                ${Object.entries(OSA_CONFIG.DATE_FILTERS).map(([k, v]) => `<option value="${k}" ${dateFilter === k ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="osa-card__body">`;

      if (!sales.length) {
        html += OSA_UI.emptyState('Nenhuma venda no período selecionado');
      } else {
        let totalPeriod = 0;
        html += `<table class="osa-table"><thead><tr><th>Ref.</th><th>Cliente</th><th>Itens</th><th>Total</th><th>Pagamento</th><th>Data</th><th>Ações</th></tr></thead><tbody>`;

        sales.forEach(s => {
          totalPeriod += s.total || 0;
          html += `<tr>
            <td><code>${OSA_UI.escapeHtml(s.reference || '')}</code></td>
            <td>${OSA_UI.escapeHtml(s.customer_name || '—')}</td>
            <td class="osa-td--number">${OSA_UI.formatNumber(s.item_count || 0)}</td>
            <td class="osa-td--number">${OSA_UI.formatCurrency(s.total)}</td>
            <td>${OSA_CONFIG.PAYMENT_METHODS[s.payment_method] || s.payment_method}</td>
            <td>${OSA_UI.formatDateTime(s.created_at)}</td>
            <td><button class="osa-btn osa-btn--sm osa-btn--outline" onclick="OSA_SALES.viewSale('${s.id}')">Ver</button></td>
          </tr>`;
        });

        html += `</tbody><tfoot><tr><td colspan="3"><strong>Total no Período</strong></td><td class="osa-td--number"><strong>${OSA_UI.formatCurrency(totalPeriod)}</strong></td><td colspan="3"></td></tr></tfoot></table>`;
      }

      html += '</div></div>';
      container.innerHTML = html;
    });
  }

  async function viewSale(id) {
    const saleRes = await getSale(id);
    if (!saleRes.ok) { OSA_UI.showError('Venda não encontrada', saleRes); return; }

    const itemsRes = await getSaleItems(id);
    const items = itemsRes.ok ? (itemsRes.data || []) : [];

    const s = saleRes.data;

    document.getElementById('module-content').innerHTML = `
      <div class="osa-card">
        <div class="osa-card__header"><h3>Venda ${OSA_UI.escapeHtml(s.reference || '')}</h3></div>
        <div class="osa-card__body">
          <div class="osa-detail-grid">
            <div><strong>Cliente:</strong> ${OSA_UI.escapeHtml(s.customer_name || '—')}</div>
            <div><strong>Telefone:</strong> ${OSA_UI.escapeHtml(s.customer_phone || '—')}</div>
            <div><strong>Pagamento:</strong> ${OSA_CONFIG.PAYMENT_METHODS[s.payment_method] || s.payment_method}</div>
            <div><strong>Data:</strong> ${OSA_UI.formatDateTime(s.created_at)}</div>
            <div><strong>Desconto:</strong> ${OSA_UI.formatCurrency(s.discount || 0)}</div>
            <div><strong>Total:</strong> ${OSA_UI.formatCurrency(s.total)}</div>
          </div>
          <table class="osa-table osa-table--compact"><thead><tr><th>Produto</th><th>Qtd</th><th>Preço Unit.</th><th>Total</th></tr></thead><tbody>
          ${items.map(i => `<tr><td>${OSA_UI.escapeHtml(i.product_name || '')}</td><td>${i.quantity}</td><td>${OSA_UI.formatCurrency(i.unit_price)}</td><td>${OSA_UI.formatCurrency(i.total)}</td></tr>`).join('')}
          </tbody></table>
          <div class="osa-form__actions">
            <button class="osa-btn osa-btn--primary" onclick="OSA_SALES.reprintReceipt('${id}')">Reimprimir Recibo</button>
            <button class="osa-btn osa-btn--secondary" onclick="OSA_SALES.renderHistory('module-content')">Voltar</button>
          </div>
        </div>
      </div>`;
  }

  async function reprintReceipt(id) {
    const saleRes = await getSale(id);
    const itemsRes = await getSaleItems(id);
    const configs = await OSA_DATA.read('configs', { single: true, filter: { column: 'key', value: 'store' } });

    if (!saleRes.ok) return;

    const storeConfig = configs.ok ? configs.data?.value : null;
    const items = itemsRes.ok ? (itemsRes.data || []) : [];
    const receipt = OSA_UI.generateReceiptHTML(saleRes.data, items, storeConfig);
    OSA_UI.printReceipt(receipt);
  }

  return {
    cart, addToCart, removeFromCart, updateCartQty, updateCartPrice, getCartTotal, resetCart,
    processSale, finalizeSale, setCustomerName, setCustomerPhone, setPaymentMethod, setDiscount,
    renderPOS, filterProducts, renderCart, renderHistory, viewSale, reprintReceipt,
    listHistory, getSale, getSaleItems
  };
})();
