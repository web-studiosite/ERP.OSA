/**
 * OSA — Authentication Module
 * Handles login, logout, session, role-based access
 */

const OSA_AUTH = (() => {
  const SESSION_KEY = 'osa_session';
  const USER_PREFS_KEY = 'osa_user_prefs';

  let _currentUser = null;
  let _currentProfile = null;

  // --- Session ---

  function saveSessionLocal(session) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at
      }));
    } catch (e) {
      console.warn('[OSA] Não foi possível guardar sessão local:', e);
    }
  }

  function clearSessionLocal() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* ignore */ }
  }

  // --- Login ---

  async function login(email, password) {
    const sb = getSupabase();
    if (!sb) return { ok: false, error: 'Supabase não configurado' };

    const { data, error } = await sb.auth.signInWithPassword({ email, password });

    if (error) {
      return { ok: false, error: error.message, status: error.status };
    }

    if (!data.session) {
      return { ok: false, error: 'Sessão não retornada pelo Supabase' };
    }

    saveSessionLocal(data.session);
    _currentUser = data.user;

    // Load profile
    const profileResult = await loadProfile(data.user.id);
    if (!profileResult.ok) {
      return { ok: false, error: 'Perfil não encontrado: ' + profileResult.error };
    }

    _currentProfile = profileResult.data;

    return { ok: true, user: data.user, profile: _currentProfile };
  }

  // --- Logout ---

  async function logout() {
    const sb = getSupabase();
    if (sb) {
      await sb.auth.signOut();
    }
    _currentUser = null;
    _currentProfile = null;
    clearSessionLocal();
  }

  // --- Session restore ---

  async function restoreSession() {
    const sb = getSupabase();
    if (!sb) return { ok: false, error: 'Supabase não configurado' };

    const { data, error } = await sb.auth.getSession();

    if (error || !data.session) {
      clearSessionLocal();
      return { ok: false, error: error?.message || 'Sem sessão ativa' };
    }

    _currentUser = data.session.user;
    saveSessionLocal(data.session);

    const profileResult = await loadProfile(_currentUser.id);
    if (!profileResult.ok) {
      return { ok: false, error: 'Perfil não encontrado' };
    }

    _currentProfile = profileResult.data;
    return { ok: true, user: _currentUser, profile: _currentProfile };
  }

  // --- Profile ---

  async function loadProfile(userId) {
    return OSA_DATA.read('profiles', {
      filter: { column: 'id', value: userId },
      single: true
    });
  }

  // --- Current user getters ---

  function getCurrentUser() {
    return _currentUser;
  }

  function getCurrentProfile() {
    return _currentProfile;
  }

  function getRole() {
    return _currentProfile?.role || null;
  }

  function getRoleLevel() {
    const role = getRole();
    return OSA_CONFIG.ROLES[role]?.level || 0;
  }

  function isAdmin() {
    return getRole() === 'admin';
  }

  function isJuniorAdmin() {
    return getRole() === 'junior_admin' || isAdmin();
  }

  // Alias for clarity — junior_admin and above (admin)
  function isJuniorAdminOrAbove() {
    return isJuniorAdmin();
  }

  function isCashier() {
    return getRole() === 'cashier';
  }

  function canSeeCosts() {
    return isJuniorAdmin();
  }

  function canSeeProfits() {
    return isJuniorAdmin();
  }

  function canDelete() {
    return isAdmin();
  }

  function canManageUsers() {
    return isAdmin();
  }

  function canManageCategories() {
    return isAdmin();
  }

  function canManageConfigs() {
    return isAdmin();
  }

  function canManageTransfers() {
    return isJuniorAdmin();
  }

  function canManageInventory() {
    return isJuniorAdmin();
  }

  function canManageLosses() {
    return isJuniorAdmin();
  }

  function canManageThefts() {
    return isJuniorAdmin();
  }

  function canManageFuel() {
    return isJuniorAdmin();
  }

  function canViewReports() {
    return isJuniorAdmin();
  }

  function canViewAudit() {
    return isAdmin();
  }

  function canManageClosings() {
    return isAdmin();
  }

  // --- User preferences (localStorage only for UI preferences) ---

  function getUserPrefs() {
    try {
      return JSON.parse(localStorage.getItem(USER_PREFS_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function setUserPrefs(prefs) {
    try {
      localStorage.setItem(USER_PREFS_KEY, JSON.stringify(prefs));
    } catch (e) { /* ignore */ }
  }

  // --- Password reset ---

  async function resetPassword(email) {
    const sb = getSupabase();
    if (!sb) return { ok: false, error: 'Supabase não configurado' };

    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/login.html'
    });

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  // --- Register user (admin only via Supabase admin) ---

  async function registerUser(email, password, fullName, role) {
    const sb = getSupabase();
    if (!sb) return { ok: false, error: 'Supabase não configurado' };

    // Use admin auth to create user — requires service role key or admin dashboard
    // For now, use signUp with metadata
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role: role
        }
      }
    });

    if (error) return { ok: false, error: error.message, status: error.status };
    if (!data.user) return { ok: false, error: 'Utilizador não criado pelo Supabase' };

    return { ok: true, user: data.user };
  }

  // --- Show register form (modal) ---

  function showRegisterForm() {
    if (!isAdmin()) {
      OSA_UI.showError('Sem permissão', 'Apenas administradores podem criar utilizadores.');
      return;
    }

    const roleOpts = Object.entries(OSA_CONFIG.ROLES || { admin: 'Administrador', junior_admin: 'Admin Júnior', cashier: 'Caixa' })
      .map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

    const overlay = document.createElement('div');
    overlay.className = 'osa-modal-overlay';
    overlay.innerHTML = `
      <div class="osa-modal" style="max-width:440px">
        <div class="osa-modal__header"><h3>Novo Utilizador</h3></div>
        <form id="osa-register-form" class="osa-form" style="padding:1rem">
          <div class="osa-form__group">
            <label>Nome Completo</label>
            <input type="text" name="full_name" required placeholder="Nome do utilizador">
          </div>
          <div class="osa-form__group">
            <label>Email</label>
            <input type="email" name="email" required placeholder="email@exemplo.com">
          </div>
          <div class="osa-form__group">
            <label>Senha</label>
            <input type="password" name="password" required minlength="6" placeholder="Mínimo 6 caracteres">
          </div>
          <div class="osa-form__group">
            <label>Papel</label>
            <select name="role">${roleOpts}</select>
          </div>
          <div class="osa-form__actions">
            <button type="submit" class="osa-btn osa-btn--primary">Criar Utilizador</button>
            <button type="button" class="osa-btn osa-btn--outline" id="osa-register-cancel">Cancelar</button>
          </div>
        </form>
      </div>`;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('osa-modal-overlay--show'));

    const closeModal = () => {
      overlay.classList.remove('osa-modal-overlay--show');
      setTimeout(() => overlay.remove(), 300);
    };

    overlay.querySelector('#osa-register-cancel').onclick = closeModal;
    overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

    document.getElementById('osa-register-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const email = fd.get('email').trim();
      const password = fd.get('password');
      const fullName = fd.get('full_name').trim();
      const role = fd.get('role');

      const btn = e.target.querySelector('[type=submit]');
      OSA_UI.setButtonLoading(btn, true);

      const res = await registerUser(email, password, fullName, role);
      OSA_UI.setButtonLoading(btn, false);

      if (res.ok) {
        closeModal();
        OSA_UI.notifySuccess('Utilizador criado com sucesso');
        // Refresh settings page if visible
        if (typeof OSA_SETTINGS !== 'undefined' && OSA_SETTINGS.renderSettings) {
          OSA_SETTINGS.renderSettings('page-content');
        }
      } else {
        OSA_UI.showError('Erro ao criar utilizador', res.error);
      }
    };
  }

  // --- Update profile ---

  async function updateProfile(userId, updates) {
    return OSA_DATA.update('profiles', userId, updates);
  }

  return {
    login,
    logout,
    restoreSession,
    getCurrentUser,
    getCurrentProfile,
    getRole,
    getRoleLevel,
    isAdmin,
    isJuniorAdmin,
    isJuniorAdminOrAbove,
    isCashier,
    canSeeCosts,
    canSeeProfits,
    canDelete,
    canManageUsers,
    canManageCategories,
    canManageConfigs,
    canManageTransfers,
    canManageInventory,
    canManageLosses,
    canManageThefts,
    canManageFuel,
    canViewReports,
    canViewAudit,
    canManageClosings,
    getUserPrefs,
    setUserPrefs,
    resetPassword,
    registerUser,
    showRegisterForm,
    updateProfile,
    loadProfile
  };
})();
