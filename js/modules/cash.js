/**
 * OSA — Cash Register Module
 */

const OSA_CASH = (() => {

  // --- Open register ---

  async function openRegister(openingBalance) {
    const userId = OSA_AUTH.getCurrentUser()?.id;
    const record = {
      opened_by: userId,
      opening_balance: openingBalance,
      status: 'open'
    };

    const res = await OSA_DATA.create('cash_registers', record);
    if (res.ok) {
      await OSA_DATA.audit('CREATE', 'cash_registers', res.data.id, null, res.data);
      OSA_UI.notifySuccess(`Caixa aberto com ${OSA_UI.formatCurrency(openingBalance)}`);
    } else {
      OSA_UI.showError('Erro ao abrir caixa', res);
    }
    return res;
  }

  // --- Get active register ---

  async function getActiveRegister() {
    return OSA_DATA.read('cash_registers', {
      single: true,
      filters: [{ column: 'status', operator: 'eq', value: 'open' }],
      order: { column: 'opened_at', ascending: false }
    });
  }

  // --- Close register ---

  async function closeRegister(registerId, closingBalance, note) {
    const res = await OSA_DATA.update('cash_registers', registerId, {
      closing_balance: closingBalance,
      closed_by: OSA_AUTH.getCurrentUser()?.id,
      closed_at: new Date().toISOString(),
      status: 'closed',
      note: note || null
    });

    if (res.ok) {
      await OSA_DATA.audit('UPDATE', 'cash_registers', registerId, null, res.data);
      OSA_UI.notifySuccess('Caixa fechado');

      // Generate receipt
      const configs = await OSA_DATA.read('configs', { single: true, filter: { column: 'key', value: 'store' } });
      const storeConfig = configs.ok ? configs.data?.value : null;
      const receipt = OSA_UI.generateMovementReceiptHTML({
        movement_type: 'cash_close',
        created_at: new Date().toISOString(),
        note: `Fecho de caixa. Saldo: ${OSA_UI.formatCurrency(closingBalance)}`
      }, storeConfig);
      OSA_UI.printReceipt(receipt);
    } else {
      OSA_UI.showError('Erro ao fechar caixa', res);
    }
    return res;
  }

  // --- Register cash movement (in/out) ---

  async function registerMovement(registerId, type, amount, description) {
    const record = {
      register_id: registerId,
      movement_type: type, // 'in' or 'out'
      amount: amount,
      description: description || null,
      created_by: OSA_AUTH.getCurrentUser()?.id
    };

    const res = await OSA_DATA.create('cash_movements', record);
    if (res.ok) {
      await OSA_DATA.audit('CREATE', 'cash_movements', res.data.id, null, res.data);
      OSA_UI.notifySuccess(`Movimentação de caixa registada: ${type === 'in' ? '+' : '-'}${OSA_UI.formatCurrency(amount)}`);
    } else {
      OSA_UI.showError('Erro ao registar movimentação', res);
    }
    return res;
  }

  // --- Get cash movements for register ---

  async function getMovements(registerId) {
    return OSA_DATA.read('cash_movements', {
      filters: [{ column: 'register_id', operator: 'eq', value: registerId }],
      order: { column: 'created_at', ascending: false }
    });
  }

  // --- Calculate expected balance ---

  async function calculateBalance(registerId) {
    const regRes = await OSA_DATA.read('cash_registers', {
      single: true, filter: { column: 'id', value: registerId }
    });
    if (!regRes.ok) return regRes;

    const movRes = await getMovements(registerId);
    if (!movRes.ok) return movRes;

    const reg = regRes.data;
    const movements = movRes.data || [];

    let balance = parseFloat(reg.opening_balance) || 0;
    let totalIn = 0;
    let totalOut = 0;

    movements.forEach(m => {
      if (m.movement_type === 'in') {
        balance += parseFloat(m.amount) || 0;
        totalIn += parseFloat(m.amount) || 0;
      } else {
        balance -= parseFloat(m.amount) || 0;
        totalOut += parseFloat(m.amount) || 0;
      }
    });

    return { ok: true, balance, totalIn, totalOut, openingBalance: reg.opening_balance };
  }

  // --- Render cash register interface ---

  async function renderRegister(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const activeRes = await getActiveRegister();

    if (!activeRes.ok || activeRes.notFound) {
      // No open register — show open form
      container.innerHTML = `
        <div class="osa-card">
          <div class="osa-card__header"><h3>Abrir Caixa</h3></div>
          <div class="osa-card__body">
            <form id="cash-open-form" class="osa-form">
              <div class="osa-form__group">
                <label>Saldo Inicial (MZN) *</label>
                <input type="number" name="opening_balance" step="0.01" min="0" value="0" required>
              </div>
              <div class="osa-form__actions">
                <button type="submit" class="osa-btn osa-btn--primary osa-btn--lg">Abrir Caixa</button>
              </div>
            </form>
          </div>
        </div>`;

      document.getElementById('cash-open-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const amount = parseFloat(fd.get('opening_balance')) || 0;
        const btn = e.target.querySelector('[type=submit]');
        OSA_UI.setButtonLoading(btn, true);
        await openRegister(amount);
        OSA_UI.setButtonLoading(btn, false);
        renderRegister('module-content');
      };
      return;
    }

    // Active register — show status + movements
    const reg = activeRes.data;
    const balRes = await calculateBalance(reg.id);
    const balance = balRes.ok ? balRes : { balance: 0, totalIn: 0, totalOut: 0, openingBalance: reg.opening_balance };

    container.innerHTML = `
      <div class="osa-card">
        <div class="osa-card__header osa-card__header--actions">
          <h3>Caixa — Aberto</h3>
          <button class="osa-btn osa-btn--danger" onclick="OSA_CASH.closeRegisterUI()">Fechar Caixa</button>
        </div>
        <div class="osa-card__body">
          <div class="osa-stat-grid">
            <div class="osa-stat"><div class="osa-stat__label">Saldo Inicial</div><div class="osa-stat__value">${OSA_UI.formatCurrency(balance.openingBalance)}</div></div>
            <div class="osa-stat"><div class="osa-stat__label">Entradas</div><div class="osa-stat__value osa-stat__value--success">+${OSA_UI.formatCurrency(balance.totalIn)}</div></div>
            <div class="osa-stat"><div class="osa-stat__label">Saídas</div><div class="osa-stat__value osa-stat__value--danger">-${OSA_UI.formatCurrency(balance.totalOut)}</div></div>
            <div class="osa-stat"><div class="osa-stat__label">Saldo Atual</div><div class="osa-stat__value osa-stat__value--primary">${OSA_UI.formatCurrency(balance.balance)}</div></div>
          </div>

          <form id="cash-movement-form" class="osa-form" style="margin-top:1rem">
            <div class="osa-form__row">
              <div class="osa-form__group">
                <label>Tipo</label>
                <select name="movement_type">
                  <option value="in">Entrada</option>
                  <option value="out">Saída</option>
                </select>
              </div>
              <div class="osa-form__group">
                <label>Valor (MZN)</label>
                <input type="number" name="amount" step="0.01" min="0.01" required>
              </div>
            </div>
            <div class="osa-form__group">
              <label>Descrição</label>
              <input type="text" name="description" placeholder="Motivo da movimentação">
            </div>
            <button type="submit" class="osa-btn osa-btn--primary">Registar Movimentação</button>
          </form>

          <div id="cash-movements-list" style="margin-top:1.5rem"></div>
        </div>
      </div>`;

    document.getElementById('cash-movement-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('[type=submit]');
      OSA_UI.setButtonLoading(btn, true);

      await registerMovement(reg.id, fd.get('movement_type'), parseFloat(fd.get('amount')), fd.get('description'));

      OSA_UI.setButtonLoading(btn, false);
      e.target.reset();
      renderRegister('module-content');
    });

    // Load movements
    renderMovements('cash-movements-list', reg.id);
  }

  function renderMovements(containerId, registerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    getMovements(registerId).then(res => {
      if (!res.ok) { container.innerHTML = ''; return; }

      const items = res.data || [];
      if (!items.length) { container.innerHTML = ''; return; }

      let html = '<table class="osa-table osa-table--compact"><thead><tr><th>Hora</th><th>Tipo</th><th>Valor</th><th>Descrição</th></tr></thead><tbody>';

      items.forEach(m => {
        html += `<tr>
          <td>${OSA_UI.formatTime(m.created_at)}</td>
          <td><span class="osa-badge ${m.movement_type === 'in' ? 'osa-badge--success' : 'osa-badge--danger'}">${m.movement_type === 'in' ? 'Entrada' : 'Saída'}</span></td>
          <td class="osa-td--number">${m.movement_type === 'in' ? '+' : '-'}${OSA_UI.formatCurrency(m.amount)}</td>
          <td>${OSA_UI.escapeHtml(m.description || '')}</td>
        </tr>`;
      });

      html += '</tbody></table>';
      container.innerHTML = html;
    });
  }

  function closeRegisterUI() {
    OSA_UI.confirm('Fechar o caixa? Deve contar o dinheiro físico e inserir o valor.', async () => {
      const balRes = await calculateBalance(
        (await getActiveRegister()).data?.id
      );

      const expected = balRes.ok ? balRes.balance : 0;

      const container = document.getElementById('module-content');
      container.innerHTML = `
        <div class="osa-card">
          <div class="osa-card__header"><h3>Fechar Caixa</h3></div>
          <div class="osa-card__body">
            <div class="osa-stat-grid">
              <div class="osa-stat"><div class="osa-stat__label">Saldo Esperado</div><div class="osa-stat__value">${OSA_UI.formatCurrency(expected)}</div></div>
            </div>
            <form id="cash-close-form" class="osa-form" style="margin-top:1rem">
              <div class="osa-form__group">
                <label>Saldo Contado (MZN) *</label>
                <input type="number" name="closing_balance" step="0.01" min="0" required>
              </div>
              <div class="osa-form__group">
                <label>Nota</label>
                <textarea name="note" rows="2" placeholder="Diferenças, observações..."></textarea>
              </div>
              <div class="osa-form__actions">
                <button type="submit" class="osa-btn osa-btn--danger">Fechar Caixa</button>
                <button type="button" class="osa-btn osa-btn--secondary" onclick="OSA_CASH.renderRegister('module-content')">Cancelar</button>
              </div>
            </form>
          </div>
        </div>`;

      document.getElementById('cash-close-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const reg = (await getActiveRegister()).data;
        if (!reg) return;

        const btn = e.target.querySelector('[type=submit]');
        OSA_UI.setButtonLoading(btn, true);

        await closeRegister(reg.id, parseFloat(fd.get('closing_balance')), fd.get('note'));

        OSA_UI.setButtonLoading(btn, false);
        renderRegister('module-content');
      };
    }, { danger: true });
  }

  return {
    openRegister, getActiveRegister, closeRegister, registerMovement, getMovements, calculateBalance,
    renderRegister, renderMovements, closeRegisterUI
  };
})();
