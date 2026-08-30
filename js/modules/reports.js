/**
 * OSA — Reports Module with Chart.js
 */

const OSA_REPORTS = (() => {

  let charts = {};

  function destroyCharts() {
    Object.values(charts).forEach(c => { if (c) c.destroy(); });
    charts = {};
  }

  // --- Sales Report ---

  async function getSalesReport(dateFrom, dateTo) {
    const res = await OSA_DATA.read('sales', {
      filters: [
        { column: 'created_at', operator: 'gte', value: dateFrom },
        { column: 'created_at', operator: 'lte', value: dateTo }
      ],
      order: { column: 'created_at', ascending: true }
    });

    if (!res.ok) return res;

    const sales = res.data || [];
    const summary = {
      totalSales: sales.length,
      totalRevenue: 0,
      totalCost: 0,
      totalDiscount: 0,
      byPaymentMethod: {},
      byDay: {}
    };

    sales.forEach(s => {
      summary.totalRevenue += parseFloat(s.total) || 0;
      summary.totalCost += parseFloat(s.cost_total) || 0;
      summary.totalDiscount += parseFloat(s.discount) || 0;

      const method = s.payment_method || 'cash';
      summary.byPaymentMethod[method] = (summary.byPaymentMethod[method] || 0) + (parseFloat(s.total) || 0);

      const day = s.created_at?.substring(0, 10);
      if (day) {
        if (!summary.byDay[day]) summary.byDay[day] = { revenue: 0, cost: 0, count: 0 };
        summary.byDay[day].revenue += parseFloat(s.total) || 0;
        summary.byDay[day].cost += parseFloat(s.cost_total) || 0;
        summary.byDay[day].count++;
      }
    });

    summary.totalProfit = summary.totalRevenue - summary.totalCost;
    summary.profitMargin = summary.totalRevenue > 0 ? (summary.totalProfit / summary.totalRevenue * 100) : 0;

    return { ok: true, data: summary, raw: sales };
  }

  // --- Stock Report ---

  async function getStockReport() {
    const productsRes = await OSA_DATA.read('products', {
      filters: [{ column: 'is_active', operator: 'eq', value: true }],
      order: { column: 'name', ascending: true }
    });

    if (!productsRes.ok) return productsRes;

    const products = productsRes.data || [];
    const balances = [];

    for (const p of products) {
      const wh = await OSA_STOCK.getBalance(p.id, 'warehouse');
      const st = await OSA_STOCK.getBalance(p.id, 'store');
      const whQty = wh.ok ? (wh.data || 0) : 0;
      const stQty = st.ok ? (st.data || 0) : 0;

      balances.push({
        ...p,
        warehouse_qty: whQty,
        store_qty: stQty,
        total_qty: whQty + stQty,
        stock_value: (whQty + stQty) * (parseFloat(p.cost_price) || 0)
      });
    }

    const totalValue = balances.reduce((sum, b) => sum + b.stock_value, 0);
    const lowStock = balances.filter(b => b.total_qty <= (b.min_stock || 5));

    return { ok: true, data: { balances, totalValue, lowStock } };
  }

  // --- Loss Report ---

  async function getLossReport(dateFrom, dateTo) {
    const res = await OSA_DATA.read('losses', {
      filters: [
        { column: 'created_at', operator: 'gte', value: dateFrom },
        { column: 'created_at', operator: 'lte', value: dateTo }
      ],
      order: { column: 'created_at', ascending: true }
    });

    if (!res.ok) return res;

    const losses = res.data || [];
    const summary = {
      totalLosses: losses.length,
      totalValue: 0,
      byReason: {},
      byDay: {}
    };

    losses.forEach(l => {
      summary.totalValue += parseFloat(l.cost_value) || 0;
      summary.byReason[l.reason] = (summary.byReason[l.reason] || 0) + (parseFloat(l.cost_value) || 0);

      const day = l.created_at?.substring(0, 10);
      if (day) summary.byDay[day] = (summary.byDay[day] || 0) + (parseFloat(l.cost_value) || 0);
    });

    return { ok: true, data: summary };
  }

  // --- Cash Report ---

  async function getCashReport(dateFrom, dateTo) {
    const res = await OSA_DATA.read('cash_movements', {
      filters: [
        { column: 'created_at', operator: 'gte', value: dateFrom },
        { column: 'created_at', operator: 'lte', value: dateTo }
      ],
      order: { column: 'created_at', ascending: true }
    });

    if (!res.ok) return res;

    const movements = res.data || [];
    const summary = {
      totalIn: 0,
      totalOut: 0,
      net: 0,
      byDay: {}
    };

    movements.forEach(m => {
      const amt = parseFloat(m.amount) || 0;
      if (m.movement_type === 'in') {
        summary.totalIn += amt;
      } else {
        summary.totalOut += amt;
      }

      const day = m.created_at?.substring(0, 10);
      if (day) {
        if (!summary.byDay[day]) summary.byDay[day] = { totalIn: 0, totalOut: 0 };
        if (m.movement_type === 'in') summary.byDay[day].totalIn += amt;
        else summary.byDay[day].totalOut += amt;
      }
    });

    summary.net = summary.totalIn - summary.totalOut;

    return { ok: true, data: summary };
  }

  // --- Render Reports Dashboard ---

  function renderMenu(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const reportTypes = [
      { key: 'sales', label: 'Vendas', icon: '📊' },
      { key: 'stock', label: 'Stock', icon: '📦' },
      { key: 'losses', label: 'Perdas', icon: '❌' },
      { key: 'cash', label: 'Caixa', icon: '💰' }
    ];

    container.innerHTML = `
      <div class="osa-card">
        <div class="osa-card__header"><h3>Relatórios</h3></div>
        <div class="osa-card__body">
          <div class="osa-report-grid">
            ${reportTypes.map(r => `
              <div class="osa-report-card" onclick="OSA_REPORTS.renderReport('${r.key}')">
                <div class="osa-report-card__icon">${r.icon}</div>
                <div class="osa-report-card__label">${r.label}</div>
              </div>
            `).join('')}
          </div>
          <div id="report-content" style="margin-top:1.5rem"></div>
        </div>
      </div>`;
  }

  async function renderReport(type) {
    const contentEl = document.getElementById('report-content');
    if (!contentEl) return;

    destroyCharts();
    OSA_UI.setLoading('report-content', true);

    const today = new Date();
    const dateFrom = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const dateTo = today.toISOString().split('T')[0];

    switch (type) {
      case 'sales': await renderSalesReport(contentEl, dateFrom, dateTo); break;
      case 'stock': await renderStockReport(contentEl); break;
      case 'losses': await renderLossReport(contentEl, dateFrom, dateTo); break;
      case 'cash': await renderCashReport(contentEl, dateFrom, dateTo); break;
    }
  }

  async function renderSalesReport(container, dateFrom, dateTo) {
    const report = await getSalesReport(dateFrom, dateTo);

    if (!report.ok) {
      container.innerHTML = `<div class="osa-alert osa-alert--error">Erro ao carregar relatório</div>`;
      return;
    }

    const d = report.data;

    container.innerHTML = `
      <div class="osa-report">
        <div class="osa-report__header">
          <h4>Relatório de Vendas</h4>
          <div class="osa-report__date-range">
            <input type="date" id="report-from" value="${dateFrom}">
            <input type="date" id="report-to" value="${dateTo}">
            <button class="osa-btn osa-btn--sm osa-btn--primary" onclick="OSA_REPORTS.renderReport('sales')">Atualizar</button>
          </div>
        </div>

        <div class="osa-stat-grid">
          <div class="osa-stat"><div class="osa-stat__label">Vendas</div><div class="osa-stat__value">${OSA_UI.formatNumber(d.totalSales)}</div></div>
          <div class="osa-stat"><div class="osa-stat__label">Receita</div><div class="osa-stat__value osa-stat__value--success">${OSA_UI.formatCurrency(d.totalRevenue)}</div></div>
          <div class="osa-stat"><div class="osa-stat__label">Custo</div><div class="osa-stat__value">${OSA_AUTH.canSeeCosts() ? OSA_UI.formatCurrency(d.totalCost) : '—'}</div></div>
          <div class="osa-stat"><div class="osa-stat__label">Lucro</div><div class="osa-stat__value osa-stat__value--primary">${OSA_AUTH.canSeeCosts() ? OSA_UI.formatCurrency(d.totalProfit) : '—'}</div></div>
          <div class="osa-stat"><div class="osa-stat__label">Margem</div><div class="osa-stat__value">${OSA_AUTH.canSeeCosts() ? OSA_UI.formatNumber(d.profitMargin, 1) + '%' : '—'}</div></div>
          <div class="osa-stat"><div class="osa-stat__label">Descontos</div><div class="osa-stat__value osa-stat__value--warning">${OSA_UI.formatCurrency(d.totalDiscount)}</div></div>
        </div>

        <div class="osa-chart-row">
          <div class="osa-chart-card">
            <h5>Receita Diária</h5>
            <canvas id="chart-sales-daily"></canvas>
          </div>
          <div class="osa-chart-card">
            <h5>Métodos de Pagamento</h5>
            <canvas id="chart-sales-payment"></canvas>
          </div>
        </div>

        <div style="margin-top:1rem;text-align:right">
          <button class="osa-btn osa-btn--outline" onclick="OSA_REPORTS.exportSalesCSV('${dateFrom}','${dateTo}')">Exportar CSV</button>
        </div>
      </div>`;

    // Daily revenue chart
    const days = Object.keys(d.byDay).sort();
    charts.salesDaily = new Chart(document.getElementById('chart-sales-daily'), {
      type: 'line',
      data: {
        labels: days.map(day => OSA_UI.formatDate(day)),
        datasets: [
          {
            label: 'Receita',
            data: days.map(day => d.byDay[day].revenue),
            borderColor: '#059669',
            backgroundColor: 'rgba(5,150,105,0.1)',
            fill: true,
            tension: 0.3
          },
          ...(OSA_AUTH.canSeeCosts() ? [{
            label: 'Custo',
            data: days.map(day => d.byDay[day].cost),
            borderColor: '#dc2626',
            backgroundColor: 'rgba(220,38,38,0.1)',
            fill: true,
            tension: 0.3
          }] : [])
        ]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { ticks: { callback: v => OSA_UI.formatCurrency(v) } } } }
    });

    // Payment method chart
    const methods = Object.keys(d.byPaymentMethod);
    const methodColors = ['#059669', '#2563eb', '#d97706', '#7c3aed', '#dc2626'];
    charts.salesPayment = new Chart(document.getElementById('chart-sales-payment'), {
      type: 'doughnut',
      data: {
        labels: methods.map(m => OSA_CONFIG.PAYMENT_METHODS[m] || m),
        datasets: [{
          data: methods.map(m => d.byPaymentMethod[m]),
          backgroundColor: methodColors.slice(0, methods.length)
        }]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });
  }

  async function renderStockReport(container) {
    const report = await getStockReport();

    if (!report.ok) {
      container.innerHTML = `<div class="osa-alert osa-alert--error">Erro ao carregar relatório</div>`;
      return;
    }

    const d = report.data;

    container.innerHTML = `
      <div class="osa-report">
        <h4>Relatório de Stock</h4>

        <div class="osa-stat-grid">
          <div class="osa-stat"><div class="osa-stat__label">Produtos</div><div class="osa-stat__value">${d.balances.length}</div></div>
          <div class="osa-stat"><div class="osa-stat__label">Valor Total Stock</div><div class="osa-stat__value osa-stat__value--primary">${OSA_AUTH.canSeeCosts() ? OSA_UI.formatCurrency(d.totalValue) : '—'}</div></div>
          <div class="osa-stat"><div class="osa-stat__label">Stock Baixo</div><div class="osa-stat__value osa-stat__value--danger">${d.lowStock.length}</div></div>
        </div>

        <div class="osa-chart-row">
          <div class="osa-chart-card">
            <h5>Top 10 por Valor de Stock</h5>
            <canvas id="chart-stock-value"></canvas>
          </div>
          <div class="osa-chart-card">
            <h5>Stock Baixo</h5>
            <canvas id="chart-stock-low"></canvas>
          </div>
        </div>

        ${d.lowStock.length ? `
        <h5 style="margin-top:1rem">Produtos com Stock Baixo</h5>
        <table class="osa-table osa-table--compact"><thead><tr><th>Produto</th><th>Armazém</th><th>Loja</th><th>Total</th><th>Mín.</th></tr></thead><tbody>
          ${d.lowStock.map(p => `<tr class="osa-tr--danger"><td>${OSA_UI.escapeHtml(p.name)}</td><td class="osa-td--number">${OSA_UI.formatNumber(p.warehouse_qty)}</td><td class="osa-td--number">${OSA_UI.formatNumber(p.store_qty)}</td><td class="osa-td--number">${OSA_UI.formatNumber(p.total_qty)}</td><td class="osa-td--number">${OSA_UI.formatNumber(p.min_stock || 5)}</td></tr>`).join('')}
        </tbody></table>` : ''}
      </div>`;

    // Stock value chart (top 10)
    const top10 = [...d.balances].sort((a, b) => b.stock_value - a.stock_value).slice(0, 10);
    charts.stockValue = new Chart(document.getElementById('chart-stock-value'), {
      type: 'bar',
      data: {
        labels: top10.map(p => p.name?.substring(0, 20)),
        datasets: [{
          label: 'Valor',
          data: top10.map(p => p.stock_value),
          backgroundColor: '#2563eb'
        }]
      },
      options: {
        responsive: true,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { callback: v => OSA_UI.formatCurrency(v) } } }
      }
    });

    // Low stock chart
    if (d.lowStock.length) {
      charts.stockLow = new Chart(document.getElementById('chart-stock-low'), {
        type: 'bar',
        data: {
          labels: d.lowStock.map(p => p.name?.substring(0, 20)),
          datasets: [
            { label: 'Atual', data: d.lowStock.map(p => p.total_qty), backgroundColor: '#dc2626' },
            { label: 'Mínimo', data: d.lowStock.map(p => p.min_stock || 5), backgroundColor: '#9ca3af' }
          ]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
      });
    }
  }

  async function renderLossReport(container, dateFrom, dateTo) {
    const report = await getLossReport(dateFrom, dateTo);

    if (!report.ok) {
      container.innerHTML = `<div class="osa-alert osa-alert--error">Erro ao carregar relatório</div>`;
      return;
    }

    const d = report.data;

    container.innerHTML = `
      <div class="osa-report">
        <h4>Relatório de Perdas</h4>

        <div class="osa-stat-grid">
          <div class="osa-stat"><div class="osa-stat__label">Total Perdas</div><div class="osa-stat__value">${OSA_UI.formatNumber(d.totalLosses)}</div></div>
          <div class="osa-stat"><div class="osa-stat__label">Valor Total</div><div class="osa-stat__value osa-stat__value--danger">${OSA_UI.formatCurrency(d.totalValue)}</div></div>
        </div>

        <div class="osa-chart-row">
          <div class="osa-chart-card">
            <h5>Perdas por Motivo</h5>
            <canvas id="chart-loss-reason"></canvas>
          </div>
          <div class="osa-chart-card">
            <h5>Perdas Diárias</h5>
            <canvas id="chart-loss-daily"></canvas>
          </div>
        </div>
      </div>`;

    const reasons = Object.keys(d.byReason);
    const reasonColors = ['#dc2626', '#d97706', '#7c3aed', '#059669', '#6b7280'];
    charts.lossReason = new Chart(document.getElementById('chart-loss-reason'), {
      type: 'pie',
      data: {
        labels: reasons.map(r => ({
          expired: 'Expirado', damaged: 'Danificado', spoiled: 'Estragado', quality: 'Qualidade', other: 'Outro'
        })[r] || r),
        datasets: [{ data: reasons.map(r => d.byReason[r]), backgroundColor: reasonColors.slice(0, reasons.length) }]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });

    const days = Object.keys(d.byDay).sort();
    charts.lossDaily = new Chart(document.getElementById('chart-loss-daily'), {
      type: 'bar',
      data: {
        labels: days.map(day => OSA_UI.formatDate(day)),
        datasets: [{
          label: 'Valor',
          data: days.map(day => d.byDay[day]),
          backgroundColor: '#dc2626'
        }]
      },
      options: { responsive: true, scales: { y: { ticks: { callback: v => OSA_UI.formatCurrency(v) } } } }
    });
  }

  async function renderCashReport(container, dateFrom, dateTo) {
    const report = await getCashReport(dateFrom, dateTo);

    if (!report.ok) {
      container.innerHTML = `<div class="osa-alert osa-alert--error">Erro ao carregar relatório</div>`;
      return;
    }

    const d = report.data;

    container.innerHTML = `
      <div class="osa-report">
        <h4>Relatório de Caixa</h4>

        <div class="osa-stat-grid">
          <div class="osa-stat"><div class="osa-stat__label">Entradas</div><div class="osa-stat__value osa-stat__value--success">${OSA_UI.formatCurrency(d.totalIn)}</div></div>
          <div class="osa-stat"><div class="osa-stat__label">Saídas</div><div class="osa-stat__value osa-stat__value--danger">${OSA_UI.formatCurrency(d.totalOut)}</div></div>
          <div class="osa-stat"><div class="osa-stat__label">Líquido</div><div class="osa-stat__value osa-stat__value--primary">${OSA_UI.formatCurrency(d.net)}</div></div>
        </div>

        <div class="osa-chart-row">
          <div class="osa-chart-card">
            <h5>Movimentações Diárias</h5>
            <canvas id="chart-cash-daily"></canvas>
          </div>
        </div>
      </div>`;

    const days = Object.keys(d.byDay).sort();
    charts.cashDaily = new Chart(document.getElementById('chart-cash-daily'), {
      type: 'bar',
      data: {
        labels: days.map(day => OSA_UI.formatDate(day)),
        datasets: [
          { label: 'Entradas', data: days.map(day => d.byDay[day]?.totalIn || 0), backgroundColor: '#059669' },
          { label: 'Saídas', data: days.map(day => d.byDay[day]?.totalOut || 0), backgroundColor: '#dc2626' }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: { y: { ticks: { callback: v => OSA_UI.formatCurrency(v) } } }
      }
    });
  }

  // --- Export ---

  async function exportSalesCSV(dateFrom, dateTo) {
    const report = await getSalesReport(dateFrom, dateTo);
    if (!report.ok) return;

    const rows = report.raw.map(s => ({
      Data: OSA_UI.formatDate(s.created_at),
      Cliente: s.customer_name || '',
      Total: s.total,
      Custo: s.cost_total,
      Lucro: (parseFloat(s.total) || 0) - (parseFloat(s.cost_total) || 0),
      Desconto: s.discount || 0,
      Pagamento: OSA_CONFIG.PAYMENT_METHODS[s.payment_method] || s.payment_method
    }));

    OSA_UI.exportCSV(rows, `vendas_${dateFrom}_${dateTo}`);
  }

  return { renderMenu, renderReport, getSalesReport, getStockReport, getLossReport, getCashReport, exportSalesCSV };
})();
