/**
 * OSA — Dashboard Module with Chart.js
 */

const OSA_DASHBOARD = (() => {

  let charts = {};

  function destroyCharts() {
    Object.values(charts).forEach(c => { if (c && typeof c.destroy === 'function') c.destroy(); });
    charts = {};
  }

  async function loadDashboardData() {
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

    const results = {};

    // Sales today
    const salesRes = await OSA_DATA.read('sales', {
      filters: [{ column: 'created_at', operator: 'gte', value: today + 'T00:00:00' }]
    });
    results.salesToday = salesRes.ok ? (salesRes.data || []) : [];

    // Sales last 7 days
    const sales7Res = await OSA_DATA.read('sales', {
      filters: [
        { column: 'created_at', operator: 'gte', value: sevenDaysAgo + 'T00:00:00' }
      ],
      order: { column: 'created_at', ascending: true }
    });
    results.sales7 = sales7Res.ok ? (sales7Res.data || []) : [];

    // Losses
    const lossesRes = await OSA_DATA.read('losses', {
      filters: [{ column: 'created_at', operator: 'gte', value: thirtyDaysAgo + 'T00:00:00' }]
    });
    results.losses30 = lossesRes.ok ? (lossesRes.data || []) : [];

    // Thefts
    const theftsRes = await OSA_DATA.read('thefts', {
      filters: [{ column: 'created_at', operator: 'gte', value: thirtyDaysAgo + 'T00:00:00' }]
    });
    results.thefts30 = theftsRes.ok ? (theftsRes.data || []) : [];

    // Cash register
    const cashRes = await OSA_DATA.read('cash_registers', {
      filters: [{ column: 'status', operator: 'eq', value: 'open' }],
      order: { column: 'opened_at', ascending: false }
    });
    results.openRegister = cashRes.ok && cashRes.data?.length ? cashRes.data[0] : null;

    // Pending transfers
    const transfersRes = await OSA_DATA.read('transfers', {
      filters: [{ column: 'status', operator: 'eq', value: 'pending' }]
    });
    results.pendingTransfers = transfersRes.ok ? (transfersRes.data || []) : [];

    // Store config
    const configRes = await OSA_DATA.read('configs', { single: true, filter: { column: 'key', value: 'store' } });
    results.storeConfig = configRes.ok ? (configRes.data?.value || null) : null;

    // Products with low stock
    const stockRes = await getSupabase().rpc('get_all_stock_balances');
    results.stockBalances = stockRes.data || [];
    results.stockError = stockRes.error;

    return results;
  }

  function render(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    destroyCharts();
    OSA_UI.setLoading(containerId, true);

    loadDashboardData().then(data => {
      const storeConfig = data.storeConfig;
      const accentColor = storeConfig?.accent_color || '#059669';
      const storeName = storeConfig?.name || 'Loja';
      const storeLogo = storeConfig?.logo_url;
      const storeCover = storeConfig?.cover_url;

      const salesToday = data.salesToday;
      const revenueToday = salesToday.reduce((s, x) => s + (parseFloat(x.total) || 0), 0);
      const salesCountToday = salesToday.length;
      const costToday = salesToday.reduce((s, x) => s + (parseFloat(x.cost_total) || 0), 0);
      const discountToday = salesToday.reduce((s, x) => s + (parseFloat(x.discount) || 0), 0);

      const lossesTotal = data.losses30.reduce((s, l) => s + (parseFloat(l.cost_value) || 0), 0);
      const theftsTotal = data.thefts30.reduce((s, t) => s + (parseFloat(t.cost_value) || 0), 0);

      const lowStock = (data.stockBalances || []).filter(b => b.balance > 0 && b.balance <= 5);
      const outOfStock = (data.stockBalances || []).filter(b => b.balance <= 0);

      let html = '';

      // --- Store identity header ---
      if (storeCover) {
        html += `<div class="osa-dashboard-cover" style="background-image:url('${OSA_UI.escapeHtml(storeCover)}')">
          <div class="osa-dashboard-cover__overlay">
            ${storeLogo ? `<img src="${OSA_UI.escapeHtml(storeLogo)}" class="osa-dashboard-cover__logo" alt="Logo">` : ''}
            <h1 class="osa-dashboard-cover__name">${OSA_UI.escapeHtml(storeName)}</h1>
          </div>
        </div>`;
      } else {
        html += `<div class="osa-dashboard-hero">
          <div class="osa-dashboard-hero__brand">
            ${storeLogo ? `<img src="${OSA_UI.escapeHtml(storeLogo)}" class="osa-dashboard-hero__logo" alt="Logo">` : '<div class="osa-dashboard-hero__logo-placeholder" style="background:${accentColor}">OSA</div>'}
            <div>
              <div class="osa-dashboard-hero__app">OSA — Official Shop Administrator</div>
              <div class="osa-dashboard-hero__store">${OSA_UI.escapeHtml(storeName)}</div>
            </div>
          </div>
        </div>`;
      }

      // --- Quick stats ---
      html += `<div class="osa-stat-grid osa-stat-grid--4">
        <div class="osa-stat osa-stat--clickable" onclick="OSA_NAV.navigate('sales')">
          <div class="osa-stat__icon">🛒</div>
          <div class="osa-stat__label">Vendas Hoje</div>
          <div class="osa-stat__value">${OSA_UI.formatNumber(salesCountToday)}</div>
          <div class="osa-stat__sub">${OSA_UI.formatCurrency(revenueToday)}</div>
        </div>
        <div class="osa-stat osa-stat--clickable" onclick="OSA_NAV.navigate('stock')">
          <div class="osa-stat__icon">📦</div>
          <div class="osa-stat__label">Stock Baixo</div>
          <div class="osa-stat__value osa-stat__value--warning">${lowStock.length}</div>
          <div class="osa-stat__sub">${outOfStock.length} sem stock</div>
        </div>
        <div class="osa-stat osa-stat--clickable" onclick="OSA_NAV.navigate('cash')">
          <div class="osa-stat__icon">💰</div>
          <div class="osa-stat__label">Caixa</div>
          <div class="osa-stat__value">${data.openRegister ? 'Aberta' : 'Fechada'}</div>
          <div class="osa-stat__sub">${data.openRegister ? OSA_UI.formatCurrency(data.openRegister.current_balance || 0) : ''}</div>
        </div>
        <div class="osa-stat osa-stat--clickable" onclick="OSA_NAV.navigate('transfers')">
          <div class="osa-stat__icon">🚚</div>
          <div class="osa-stat__label">Transf. Pendentes</div>
          <div class="osa-stat__value osa-stat__value--${data.pendingTransfers.length ? 'warning' : 'success'}">${data.pendingTransfers.length}</div>
        </div>
      </div>`;

      // --- Profit card (admin only) ---
      if (OSA_AUTH.canSeeCosts()) {
        const profitToday = revenueToday - costToday;
        html += `<div class="osa-stat-grid osa-stat-grid--3" style="margin-top:0.75rem">
          <div class="osa-stat">
            <div class="osa-stat__label">Custo Hoje</div>
            <div class="osa-stat__value">${OSA_UI.formatCurrency(costToday)}</div>
          </div>
          <div class="osa-stat">
            <div class="osa-stat__label">Lucro Hoje</div>
            <div class="osa-stat__value osa-stat__value--${profitToday >= 0 ? 'success' : 'danger'}">${OSA_UI.formatCurrency(profitToday)}</div>
          </div>
          <div class="osa-stat">
            <div class="osa-stat__label">Margem</div>
            <div class="osa-stat__value">${revenueToday > 0 ? OSA_UI.formatNumber((profitToday / revenueToday) * 100, 1) + '%' : '—'}</div>
          </div>
        </div>`;
      }

      // --- Charts row ---
      html += `<div class="osa-dashboard-charts">
        <div class="osa-card osa-card--chart">
          <div class="osa-card__header"><h3>Vendas — Últimos 7 Dias</h3></div>
          <div class="osa-card__body"><canvas id="chart-sales-7d" height="220"></canvas></div>
        </div>
        <div class="osa-card osa-card--chart">
          <div class="osa-card__header"><h3>Métodos de Pagamento (Hoje)</h3></div>
          <div class="osa-card__body"><canvas id="chart-payment-today" height="220"></canvas></div>
        </div>
      </div>`;

      // --- Losses / Thefts (admin only) ---
      if (OSA_AUTH.canSeeCosts()) {
        html += `<div class="osa-stat-grid osa-stat-grid--2" style="margin-top:0.75rem">
          <div class="osa-stat osa-stat--clickable" onclick="OSA_NAV.navigate('losses')">
            <div class="osa-stat__icon">📉</div>
            <div class="osa-stat__label">Perdas (30 dias)</div>
            <div class="osa-stat__value osa-stat__value--danger">${OSA_UI.formatCurrency(lossesTotal)}</div>
            <div class="osa-stat__sub">${data.losses30.length} registos</div>
          </div>
          <div class="osa-stat osa-stat--clickable" onclick="OSA_NAV.navigate('thefts')">
            <div class="osa-stat__icon">🔒</div>
            <div class="osa-stat__label">Furtos (30 dias)</div>
            <div class="osa-stat__value osa-stat__value--danger">${OSA_UI.formatCurrency(theftsTotal)}</div>
            <div class="osa-stat__sub">${data.thefts30.length} registos</div>
          </div>
        </div>`;
      }

      // --- Low stock table ---
      if (lowStock.length || outOfStock.length) {
        html += `<div class="osa-card" style="margin-top:1rem">
          <div class="osa-card__header osa-card__header--actions">
            <h3>⚠️ Alerta de Stock</h3>
            <button class="osa-btn osa-btn--sm osa-btn--outline" onclick="OSA_NAV.navigate('stock')">Ver Todo o Stock</button>
          </div>
          <div class="osa-card__body">
            <table class="osa-table osa-table--compact">
              <thead><tr><th>Produto</th><th>Armazém</th><th>Loja</th><th>Total</th></tr></thead>
              <tbody>`;

        [...outOfStock.slice(0, 5), ...lowStock.slice(0, 5)].forEach(b => {
          html += `<tr class="${b.balance <= 0 ? 'osa-row--danger' : 'osa-row--warning'}">
            <td>${OSA_UI.escapeHtml(b.product_name || 'N/A')}</td>
            <td class="osa-td--number">${OSA_UI.formatNumber(b.warehouse_balance || 0)}</td>
            <td class="osa-td--number">${OSA_UI.formatNumber(b.store_balance || 0)}</td>
            <td class="osa-td--number"><strong>${OSA_UI.formatNumber(b.balance || 0)}</strong></td>
          </tr>`;
        });

        html += '</tbody></table></div></div>';
      }

      // --- Quick actions ---
      html += `<div class="osa-card" style="margin-top:1rem">
        <div class="osa-card__header"><h3>Ações Rápidas</h3></div>
        <div class="osa-card__body">
          <div class="osa-quick-actions">
            <button class="osa-btn osa-btn--primary" onclick="OSA_NAV.navigate('sales')">🛒 Nova Venda</button>
            <button class="osa-btn osa-btn--outline" onclick="OSA_NAV.navigate('transfers')">🚚 Transferência</button>
            <button class="osa-btn osa-btn--outline" onclick="OSA_NAV.navigate('cash')">💰 Caixa</button>
            ${OSA_AUTH.isJuniorAdminOrAbove() ? '<button class="osa-btn osa-btn--outline" onclick="OSA_NAV.navigate(\'losses\')">📉 Registar Perda</button>' : ''}
            ${OSA_AUTH.isJuniorAdminOrAbove() ? '<button class="osa-btn osa-btn--outline" onclick="OSA_NAV.navigate(\'inventory\')">📝 Inventário</button>' : ''}
            ${OSA_AUTH.isAdmin() ? '<button class="osa-btn osa-btn--outline" onclick="OSA_NAV.navigate(\'closings\')">📅 Fecho Diário</button>' : ''}
          </div>
        </div>
      </div>`;

      container.innerHTML = html;

      // --- Draw charts ---
      _drawSalesChart(data.sales7);
      _drawPaymentChart(salesToday);
    }).catch(err => {
      console.error('[OSA_DASHBOARD] loadDashboardData failed:', err);
      if (data && data.stockError) console.error('[OSA_DASHBOARD] Stock RPC error:', data.stockError);
      container.innerHTML = '<div class="osa-card"><div class="osa-card__body"><p style="color:#ef4444;font-weight:600">⚠️ Erro ao carregar o painel</p><p style="color:#6b7280">Não foi possível carregar os dados. Tente novamente.</p><button class="osa-btn osa-btn--outline" onclick="OSA_DASHBOARD.render(\'' + containerId + '\')" style="margin-top:0.75rem">🔄 Tentar Novamente</button></div></div>';
    });
  }

  function _drawSalesChart(sales7) {
    const canvas = document.getElementById('chart-sales-7d');
    if (!canvas || typeof Chart === 'undefined') return;

    // Group sales by day
    const dayMap = {};
    const labels = [];
    const revenueData = [];
    const countData = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().split('T')[0];
      const label = d.toLocaleDateString('pt-MZ', { weekday: 'short', day: 'numeric' });
      labels.push(label);
      dayMap[key] = { revenue: 0, count: 0 };
    }

    sales7.forEach(s => {
      const key = s.created_at?.split('T')[0];
      if (dayMap[key]) {
        dayMap[key].revenue += parseFloat(s.total) || 0;
        dayMap[key].count++;
      }
    });

    Object.keys(dayMap).sort().forEach(k => {
      revenueData.push(dayMap[k].revenue);
      countData.push(dayMap[k].count);
    });

    charts.sales7d = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Receita (MTn)',
            data: revenueData,
            backgroundColor: 'rgba(5, 150, 105, 0.6)',
            borderColor: '#059669',
            borderWidth: 1,
            yAxisID: 'y'
          },
          {
            label: 'Nº Vendas',
            data: countData,
            type: 'line',
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: { type: 'linear', position: 'left', beginAtZero: true, ticks: { callback: v => OSA_UI.formatCurrency(v) } },
          y1: { type: 'linear', position: 'right', beginAtZero: true, grid: { drawOnChartArea: false } }
        }
      }
    });
  }

  function _drawPaymentChart(salesToday) {
    const canvas = document.getElementById('chart-payment-today');
    if (!canvas || typeof Chart === 'undefined') return;

    const methodMap = {};
    salesToday.forEach(s => {
      const m = s.payment_method || 'cash';
      const label = OSA_CONFIG.PAYMENT_METHODS[m] || m;
      methodMap[label] = (methodMap[label] || 0) + (parseFloat(s.total) || 0);
    });

    const labels = Object.keys(methodMap);
    const values = Object.values(methodMap);
    const colors = ['#059669', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

    if (!labels.length) {
      canvas.parentElement.innerHTML = '<p style="text-align:center;color:#9ca3af">Sem vendas hoje</p>';
      return;
    }

    charts.paymentToday = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors.slice(0, labels.length),
          borderWidth: 2,
          borderColor: '#fff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${OSA_UI.formatCurrency(ctx.raw)}` } }
        }
      }
    });
  }

  return { render, destroyCharts };
})();
