/**
 * OSA — Settings Module (Admin only)
 */

const OSA_SETTINGS = (() => {

  async function getStoreConfig() {
    const res = await OSA_DATA.read('configs', { single: true, filter: { column: 'key', value: 'store' } });
    return res.ok ? (res.data?.value || {}) : {};
  }

  async function saveStoreConfig(config) {
    const existing = await OSA_DATA.read('configs', { single: true, filter: { column: 'key', value: 'store' } });

    if (existing.ok && existing.data) {
      const res = await OSA_DATA.update('configs', existing.data.id, { value: config });
      if (res.ok) {
        await OSA_DATA.audit('UPDATE', 'configs', existing.data.id, null, res.data);
        OSA_UI.notifySuccess('Configurações guardadas');
      } else {
        OSA_UI.showError('Erro ao guardar', res);
      }
      return res;
    } else {
      const res = await OSA_DATA.create('configs', { key: 'store', value: config });
      if (res.ok) {
        await OSA_DATA.audit('CREATE', 'configs', res.data.id, null, res.data);
        OSA_UI.notifySuccess('Configurações criadas');
      } else {
        OSA_UI.showError('Erro ao criar', res);
      }
      return res;
    }
  }

  // --- User management ---

  async function listUsers() {
    return OSA_DATA.read('profiles', { order: { column: 'full_name', ascending: true } });
  }

  async function updateUserRole(userId, role) {
    const res = await OSA_DATA.update('profiles', userId, { role: role });
    if (res.ok) {
      await OSA_DATA.audit('UPDATE', 'profiles', userId, { role: role }, res.data);
      OSA_UI.notifySuccess('Papel atualizado');
    } else {
      OSA_UI.showError('Erro ao atualizar papel', res);
    }
    return res;
  }

  async function toggleUserActive(userId, isActive) {
    const res = await OSA_DATA.update('profiles', userId, { is_active: isActive });
    if (res.ok) {
      await OSA_DATA.audit('UPDATE', 'profiles', userId, null, res.data);
      OSA_UI.notifySuccess(isActive ? 'Utilizador ativado' : 'Utilizador desativado');
    } else {
      OSA_UI.showError('Erro ao atualizar', res);
    }
    return res;
  }

  // --- Render settings ---

  async function renderSettings(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!OSA_AUTH.isAdmin()) {
      container.innerHTML = '<div class="osa-alert osa-alert--error">Acesso restrito a administradores</div>';
      return;
    }

    OSA_UI.setLoading(containerId, true);

    const config = await getStoreConfig();
    const usersRes = await listUsers();
    const users = usersRes.ok ? (usersRes.data || []) : [];

    container.innerHTML = `
      <div class="osa-card">
        <div class="osa-card__header"><h3>Identidade da Loja</h3></div>
        <div class="osa-card__body">
          <form id="store-config-form" class="osa-form">
            <div class="osa-form__row">
              <div class="osa-form__group">
                <label>Nome da Loja</label>
                <input type="text" name="name" value="${OSA_UI.escapeHtml(config.name || '')}" placeholder="Nome da loja">
              </div>
              <div class="osa-form__group">
                <label>NUIT</label>
                <input type="text" name="nuit" value="${OSA_UI.escapeHtml(config.nuit || '')}" placeholder="NUIT da loja">
              </div>
            </div>
            <div class="osa-form__row">
              <div class="osa-form__group">
                <label>Endereço</label>
                <input type="text" name="address" value="${OSA_UI.escapeHtml(config.address || '')}" placeholder="Endereço">
              </div>
              <div class="osa-form__group">
                <label>Telefone</label>
                <input type="text" name="phone" value="${OSA_UI.escapeHtml(config.phone || '')}" placeholder="Telefone">
              </div>
            </div>
            <div class="osa-form__row">
              <div class="osa-form__group">
                <label>Cor Principal</label>
                <input type="color" name="accent_color" value="${config.accent_color || '#059669'}" style="height:40px">
              </div>
              <div class="osa-form__group">
                <label>URL do Logótipo</label>
                <input type="text" name="logo_url" value="${OSA_UI.escapeHtml(config.logo_url || '')}" placeholder="https://...">
              </div>
            </div>
            <div class="osa-form__group">
              <label>URL da Capa</label>
              <input type="text" name="cover_url" value="${OSA_UI.escapeHtml(config.cover_url || '')}" placeholder="https://...">
            </div>
            <div class="osa-form__actions">
              <button type="submit" class="osa-btn osa-btn--primary">Guardar Configurações</button>
            </div>
          </form>
        </div>
      </div>

      <div class="osa-card" style="margin-top:1rem">
        <div class="osa-card__header osa-card__header--actions">
          <h3>Utilizadores</h3>
          <button class="osa-btn osa-btn--primary" onclick="OSA_AUTH.showRegisterForm()">+ Novo Utilizador</button>
        </div>
        <div class="osa-card__body">
          ${!users.length ? OSA_UI.emptyState('Nenhum utilizador') : `
          <table class="osa-table"><thead><tr><th>Nome</th><th>Email</th><th>Papel</th><th>Ativo</th><th>Ações</th></tr></thead><tbody>
          ${users.map(u => `<tr>
            <td>${OSA_UI.escapeHtml(u.full_name || '')}</td>
            <td>${OSA_UI.escapeHtml(u.email || '')}</td>
            <td><select onchange="OSA_SETTINGS.updateUserRole('${u.id}', this.value)" class="osa-select--inline">
              ${Object.entries(OSA_CONFIG.ROLES).map(([k, v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select></td>
            <td><label class="osa-toggle"><input type="checkbox" ${u.is_active !== false ? 'checked' : ''} onchange="OSA_SETTINGS.toggleUserActive('${u.id}', this.checked)"><span class="osa-toggle__slider"></span></label></td>
            <td>${u.id !== OSA_AUTH.getCurrentUser()?.id ? `<button class="osa-btn osa-btn--sm osa-btn--danger" onclick="OSA_SETTINGS.confirmResetPassword('${u.id}')">Reset Senha</button>` : ''}</td>
          </tr>`).join('')}
          </tbody></table>`}
        </div>
      </div>`;

    document.getElementById('store-config-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);

      const configData = {
        name: fd.get('name'),
        nuit: fd.get('nuit'),
        address: fd.get('address'),
        phone: fd.get('phone'),
        accent_color: fd.get('accent_color'),
        logo_url: fd.get('logo_url'),
        cover_url: fd.get('cover_url')
      };

      const btn = e.target.querySelector('[type=submit]');
      OSA_UI.setButtonLoading(btn, true);
      await saveStoreConfig(configData);
      OSA_UI.setButtonLoading(btn, false);

      // Apply accent color immediately
      if (configData.accent_color) {
        document.documentElement.style.setProperty('--osa-accent', configData.accent_color);
      }
    };
  }

  function confirmResetPassword(userId) {
    OSA_UI.confirm('Enviar email de redefinição de senha para este utilizador?', async () => {
      // Get user email first
      const res = await OSA_DATA.read('profiles', { single: true, filter: { column: 'id', value: userId } });
      if (res.ok && res.data?.email) {
        const { error } = await getSupabase().auth.resetPasswordForEmail(res.data.email);
        if (error) OSA_UI.showError('Erro ao enviar email', error);
        else OSA_UI.notifySuccess('Email de redefinição enviado');
      }
    });
  }

  return { getStoreConfig, saveStoreConfig, listUsers, updateUserRole, toggleUserActive, renderSettings, confirmResetPassword };
})();
