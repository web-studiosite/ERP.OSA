/**
 * OSA — UI Utilities
 * Notifications, modals, formatting, loading states
 */

const OSA_UI = (() => {

  // --- Currency formatting ---

  function formatCurrency(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return '0,00 MZN';
    return new Intl.NumberFormat(OSA_CONFIG.CURRENCY_LOCALE, {
      style: 'currency',
      currency: OSA_CONFIG.CURRENCY,
      minimumFractionDigits: 2
    }).format(num);
  }

  // --- Number formatting ---

  function formatNumber(value, decimals = 0) {
    const num = parseFloat(value);
    if (isNaN(num)) return '0';
    return new Intl.NumberFormat(OSA_CONFIG.CURRENCY_LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(num);
  }

  // --- Date formatting ---

  function formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    return new Intl.DateTimeFormat('pt-MZ', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    }).format(d);
  }

  function formatDateTime(date) {
    if (!date) return '';
    const d = new Date(date);
    return new Intl.DateTimeFormat('pt-MZ', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(d);
  }

  function formatTime(date) {
    if (!date) return '';
    const d = new Date(date);
    return new Intl.DateTimeFormat('pt-MZ', {
      hour: '2-digit', minute: '2-digit'
    }).format(d);
  }

  // --- Notifications ---

  function notify(message, type = 'info', duration = 4000) {
    const container = document.getElementById('osa-notifications');
    if (!container) {
      const c = document.createElement('div');
      c.id = 'osa-notifications';
      c.className = 'osa-notification-container';
      document.body.appendChild(c);
    }

    const icons = {
      success: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="10" fill="#10b981"/><path d="M6 10l3 3 5-5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      error: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="10" fill="#ef4444"/><path d="M7 7l6 6M13 7l-6 6" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>',
      warning: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="10" fill="#f59e0b"/><path d="M10 7v3M10 13h.01" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>',
      info: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="10" fill="#3b82f6"/><path d="M10 7h.01M10 10v3" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>'
    };

    const el = document.createElement('div');
    el.className = `osa-notification osa-notification--${type}`;
    el.innerHTML = `
      <span class="osa-notification__icon">${icons[type] || icons.info}</span>
      <span class="osa-notification__message">${_escapeHtml(message)}</span>
      <button class="osa-notification__close" onclick="this.parentElement.remove()">&times;</button>
    `;

    const cont = document.getElementById('osa-notifications');
    cont.appendChild(el);

    requestAnimationFrame(() => el.classList.add('osa-notification--show'));

    if (duration > 0) {
      setTimeout(() => {
        el.classList.remove('osa-notification--show');
        setTimeout(() => el.remove(), 300);
      }, duration);
    }
  }

  function notifySuccess(msg) { notify(msg, 'success'); }
  function notifyError(msg) { notify(msg, 'error', 6000); }
  function notifyWarning(msg) { notify(msg, 'warning'); }
  function notifyInfo(msg) { notify(msg, 'info'); }

  // --- Error handler ---

  function showError(context, result) {
    const parts = [`✕ ${context}`];
    if (result.error) parts.push(result.error);
    if (result.code) parts.push(`Código: ${result.code}`);
    if (result.status) parts.push(`Status: ${result.status}`);
    if (result.details) parts.push(`Detalhes: ${result.details}`);
    notifyError(parts.join(' — '));
  }

  // --- Confirm modal ---

  function confirm(message, onConfirm, options = {}) {
    const title = options.title || 'Confirmar';
    const confirmText = options.confirmText || 'Confirmar';
    const cancelText = options.cancelText || 'Cancelar';
    const danger = options.danger || false;

    const overlay = document.createElement('div');
    overlay.className = 'osa-modal-overlay';
    overlay.innerHTML = `
      <div class="osa-modal osa-modal--confirm">
        <div class="osa-modal__header">
          <h3>${_escapeHtml(title)}</h3>
        </div>
        <div class="osa-modal__body">
          <p>${message}</p>
        </div>
        <div class="osa-modal__footer">
          <button class="osa-btn osa-btn--secondary" id="osa-confirm-cancel">${_escapeHtml(cancelText)}</button>
          <button class="osa-btn ${danger ? 'osa-btn--danger' : 'osa-btn--primary'}" id="osa-confirm-ok">${_escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('osa-modal-overlay--show'));

    overlay.querySelector('#osa-confirm-cancel').onclick = () => _closeModal(overlay);
    overlay.querySelector('#osa-confirm-ok').onclick = () => {
      _closeModal(overlay);
      onConfirm();
    };
    overlay.onclick = (e) => { if (e.target === overlay) _closeModal(overlay); };
  }

  // --- Generic modal ---

  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('osa-modal-overlay--show');
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('osa-modal-overlay--show');
  }

  function _closeModal(overlay) {
    overlay.classList.remove('osa-modal-overlay--show');
    setTimeout(() => overlay.remove(), 300);
  }

  // --- Loading states ---

  function setLoading(elementId, loading = true, text = 'A carregar...') {
    const el = document.getElementById(elementId);
    if (!el) return;

    if (loading) {
      el.dataset.originalContent = el.innerHTML;
      el.innerHTML = `<div class="osa-loading"><div class="osa-loading__spinner"></div><span>${_escapeHtml(text)}</span></div>`;
      el.disabled = true;
    } else {
      if (el.dataset.originalContent) {
        el.innerHTML = el.dataset.originalContent;
        delete el.dataset.originalContent;
      }
      el.disabled = false;
    }
  }

  function setButtonLoading(btn, loading = true, text = 'Processando...') {
    if (loading) {
      btn.dataset.originalHtml = btn.innerHTML;
      btn.innerHTML = `<span class="osa-btn__spinner"></span> ${_escapeHtml(text)}`;
      btn.disabled = true;
    } else {
      btn.innerHTML = btn.dataset.originalHtml || btn.innerHTML;
      delete btn.dataset.originalHtml;
      btn.disabled = false;
    }
  }

  // --- Empty state ---

  function emptyState(message = 'Nenhum dado encontrado', icon = 'empty') {
    return `
      <div class="osa-empty-state">
        <div class="osa-empty-state__icon">
          ${icon === 'empty' ? '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12h8M12 8v8"/></svg>' : ''}
        </div>
        <p class="osa-empty-state__message">${_escapeHtml(message)}</p>
      </div>
    `;
  }

  // --- Pagination ---

  function renderPagination(containerId, currentPage, totalPages, onPageChange) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    let html = '<div class="osa-pagination">';

    if (currentPage > 1) {
      html += `<button class="osa-pagination__btn" onclick="${onPageChange}(${currentPage - 1})">&laquo;</button>`;
    }

    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);

    if (start > 1) html += '<span class="osa-pagination__ellipsis">...</span>';

    for (let i = start; i <= end; i++) {
      html += `<button class="osa-pagination__btn ${i === currentPage ? 'osa-pagination__btn--active' : ''}" onclick="${onPageChange}(${i})">${i}</button>`;
    }

    if (end < totalPages) html += '<span class="osa-pagination__ellipsis">...</span>';

    if (currentPage < totalPages) {
      html += `<button class="osa-pagination__btn" onclick="${onPageChange}(${currentPage + 1})">&raquo;</button>`;
    }

    html += '</div>';
    container.innerHTML = html;
  }

  // --- Date filter helpers ---

  function getDateRange(filterKey, customFrom, customTo) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (filterKey) {
      case 'today':
        return { from: today.toISOString(), to: new Date(today.getTime() + 86400000).toISOString() };
      case 'yesterday':
        return { from: new Date(today.getTime() - 86400000).toISOString(), to: today.toISOString() };
      case 'last7':
        return { from: new Date(today.getTime() - 7 * 86400000).toISOString(), to: new Date(today.getTime() + 86400000).toISOString() };
      case 'last30':
        return { from: new Date(today.getTime() - 30 * 86400000).toISOString(), to: new Date(today.getTime() + 86400000).toISOString() };
      case 'this_month':
        return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString() };
      case 'custom':
        return { from: customFrom, to: customTo };
      default:
        return { from: new Date(today.getTime() - 30 * 86400000).toISOString(), to: new Date(today.getTime() + 86400000).toISOString() };
    }
  }

  // --- Escape HTML ---

  function _escapeHtml(text) {
    if (typeof text !== 'string') return text;
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  // --- Export CSV ---

  function exportCSV(data, filename) {
    if (!data || !data.length) return;
    const headers = Object.keys(data[0]);
    const csv = [
      headers.join(';'),
      ...data.map(row => headers.map(h => {
        let val = row[h];
        if (val === null || val === undefined) val = '';
        if (typeof val === 'string' && (val.includes(';') || val.includes('\n') || val.includes('"')))
          val = '"' + val.replace(/"/g, '""') + '"';
        return val;
      }).join(';'))
    ].join('\n');

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  }

  // --- Export JSON ---

  function exportJSON(data, filename) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  }

  // --- Print receipt ---

  function printReceipt(htmlContent) {
    const win = window.open('', '_blank', 'width=350,height=600');
    win.document.write(`
      <!DOCTYPE html>
      <html><head><title>Recibo — OSA</title>
      <style>
        body { font-family: 'Courier New', monospace; font-size: 12px; padding: 10px; margin: 0; }
        .center { text-align: center; }
        .bold { font-weight: bold; }
        .line { border-top: 1px dashed #333; margin: 6px 0; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 2px 0; }
        .right { text-align: right; }
        @media print { body { margin: 0; } }
      </style></head><body>${htmlContent}<script>window.print();window.close();<\/script></body></html>
    `);
    win.document.close();
  }

  // --- Generate receipt HTML ---

  function generateReceiptHTML(sale, items, config) {
    const storeName = config?.store_name || 'Loja';
    const date = formatDateTime(sale.created_at);

    let itemsHTML = items.map(item => `
      <tr><td>${_escapeHtml(item.product_name)}</td><td class="right">${formatNumber(item.quantity)}</td><td class="right">${formatCurrency(item.unit_price)}</td><td class="right">${formatCurrency(item.total)}</td></tr>
    `).join('');

    return `
      <div class="center bold">OSA</div>
      <div class="center">OFFICIAL SHOP ADMINISTRATOR</div>
      <div class="center bold" style="margin-top:4px">${_escapeHtml(storeName)}</div>
      <div class="line"></div>
      <div>Recibo: <span class="bold">${_escapeHtml(sale.reference)}</span></div>
      <div>Data: ${date}</div>
      <div>Operador: ${_escapeHtml(OSA_AUTH.getCurrentProfile()?.full_name || '')}</div>
      <div class="line"></div>
      <table>
        <thead><tr><th>Produto</th><th class="right">Qtd</th><th class="right">Preço</th><th class="right">Total</th></tr></thead>
        <tbody>${itemsHTML}</tbody>
      </table>
      <div class="line"></div>
      <div>Subtotal: ${formatCurrency(sale.total + sale.discount)}</div>
      ${sale.discount > 0 ? `<div>Desconto: -${formatCurrency(sale.discount)}</div>` : ''}
      <div class="bold" style="font-size:14px">Total: ${formatCurrency(sale.total)}</div>
      <div>Pagamento: ${OSA_CONFIG.PAYMENT_METHODS[sale.payment_method] || sale.payment_method}</div>
      <div class="line"></div>
      <div class="center" style="margin-top:8px">Obrigado pela preferência!</div>
      <div class="center">OSA — Official Shop Administrator</div>
    `;
  }

  // --- Generate movement receipt HTML ---

  function generateMovementReceiptHTML(movement, config) {
    const storeName = config?.store_name || 'Loja';
    const date = formatDateTime(movement.created_at);
    const typeLabel = OSA_CONFIG.MOVEMENT_TYPES[movement.movement_type] || movement.movement_type;

    return `
      <div class="center bold">OSA</div>
      <div class="center">OFFICIAL SHOP ADMINISTRATOR</div>
      <div class="center bold" style="margin-top:4px">${_escapeHtml(storeName)}</div>
      <div class="line"></div>
      <div class="bold">Comprovante de Movimentação</div>
      <div>Tipo: ${_escapeHtml(typeLabel)}</div>
      <div>Data: ${date}</div>
      <div>Operador: ${_escapeHtml(OSA_AUTH.getCurrentProfile()?.full_name || '')}</div>
      <div class="line"></div>
      <div>Produto: ${_escapeHtml(movement.product_name || '')}</div>
      <div>Quantidade: ${formatNumber(movement.quantity)}</div>
      <div>Localização: ${OSA_CONFIG.LOCATIONS[movement.location] || movement.location}</div>
      ${movement.unit_cost ? `<div>Custo Unit.: ${formatCurrency(movement.unit_cost)}</div>` : ''}
      ${movement.total_cost ? `<div>Custo Total: ${formatCurrency(movement.total_cost)}</div>` : ''}
      ${movement.note ? `<div>Obs.: ${_escapeHtml(movement.note)}</div>` : ''}
      <div class="line"></div>
      <div class="center">OSA — Official Shop Administrator</div>
    `;
  }

  // --- Generate transfer receipt HTML ---

  function generateTransferReceiptHTML(transfer, items, config) {
    const storeName = config?.store_name || 'Loja';
    const date = formatDateTime(transfer.created_at);

    let itemsHTML = items.map(item => `
      <tr><td>${_escapeHtml(item.product_name || item.product_id)}</td><td class="right">${formatNumber(item.quantity)}</td></tr>
    `).join('');

    return `
      <div class="center bold">OSA</div>
      <div class="center">OFFICIAL SHOP ADMINISTRATOR</div>
      <div class="center bold" style="margin-top:4px">${_escapeHtml(storeName)}</div>
      <div class="line"></div>
      <div class="bold">Comprovante de Transferência</div>
      <div>Ref: ${_escapeHtml(transfer.reference)}</div>
      <div>Data: ${date}</div>
      <div>De: ${OSA_CONFIG.LOCATIONS[transfer.from_location] || transfer.from_location}</div>
      <div>Para: ${OSA_CONFIG.LOCATIONS[transfer.to_location] || transfer.to_location}</div>
      <div>Operador: ${_escapeHtml(OSA_AUTH.getCurrentProfile()?.full_name || '')}</div>
      <div class="line"></div>
      <table>
        <thead><tr><th>Produto</th><th class="right">Quantidade</th></tr></thead>
        <tbody>${itemsHTML}</tbody>
      </table>
      <div class="line"></div>
      ${transfer.note ? `<div>Obs.: ${_escapeHtml(transfer.note)}</div>` : ''}
      <div class="center">OSA — Official Shop Administrator</div>
    `;
  }

  return {
    formatCurrency,
    formatNumber,
    formatDate,
    formatDateTime,
    formatTime,
    notify,
    notifySuccess,
    notifyError,
    notifyWarning,
    notifyInfo,
    showError,
    confirm,
    openModal,
    closeModal,
    setLoading,
    setButtonLoading,
    emptyState,
    renderPagination,
    getDateRange,
    escapeHtml: _escapeHtml,
    exportCSV,
    exportJSON,
    printReceipt,
    generateReceiptHTML,
    generateMovementReceiptHTML,
    generateTransferReceiptHTML
  };
})();
