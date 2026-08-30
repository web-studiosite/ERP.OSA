```js
/**
 * OSA — Navigation & Routing Module
 */

const OSA_NAV = (() => {

  const MODULES = {
    dashboard: {
      label: 'Painel',
      icon: '📊',
      module: 'OSA_DASHBOARD',
      method: 'render',
      roles: ['admin', 'junior_admin', 'cashier']
    },

    sales: {
      label: 'Vendas',
      icon: '🛒',
      module: 'OSA_SALES',
      method: 'renderPOS',
      roles: ['admin', 'junior_admin', 'cashier']
    },

    sales_history: {
      label: 'Histórico Vendas',
      icon: '📋',
      module: 'OSA_SALES',
      method: 'renderHistory',
      roles: ['admin', 'junior_admin', 'cashier']
    },

    products: {
      label: 'Produtos',
      icon: '📦',
      module: 'OSA_PRODUCTS',
      method: 'renderList',
      roles: ['admin', 'junior_admin']
    },

    categories: {
      label: 'Categorias',
      icon: '🏷️',
      module: 'OSA_CATEGORIES',
      method: 'renderList',
      roles: ['admin', 'junior_admin']
    },

    stock: {
      label: 'Stock',
      icon: '🏪',
      module: 'OSA_STOCK',
      method: 'renderWarehouse',
      roles: ['admin', 'junior_admin']
    },

    transfers: {
      label: 'Transferências',
      icon: '🚚',
      module: 'OSA_TRANSFERS',
      method: 'renderList',
      roles: ['admin', 'junior_admin']
    },

    cash: {
      label: 'Caixa',
      icon: '💰',
      module: 'OSA_CASH',
      method: 'renderRegister',
      roles: ['admin', 'junior_admin', 'cashier']
    },

    inventory: {
      label: 'Inventário',
      icon: '📝',
      module: 'OSA_INVENTORY',
      method: 'renderList',
      roles: ['admin', 'junior_admin']
    },

    losses: {
      label: 'Perdas',
      icon: '📉',
      module: 'OSA_LOSSES',
      method: 'renderList',
      roles: ['admin', 'junior_admin']
    },

    thefts: {
      label: 'Furtos',
      icon: '🔒',
      module: 'OSA_THEFTS',
      method: 'renderList',
      roles: ['admin', 'junior_admin']
    },

    fuel: {
      label: 'Combustível',
      icon: '⛽',
      module: 'OSA_FUEL',
      method: 'renderList',
      roles: ['admin', 'junior_admin']
    },

    closings: {
      label: 'Fechos Diários',
      icon: '📅',
      module: 'OSA_CLOSINGS',
      method: 'renderList',
      roles: ['admin', 'junior_admin']
    },

    reports: {
      label: 'Relatórios',
      icon: '📈',
      module: 'OSA_REPORTS',
      method: 'renderMenu',
      roles: ['admin', 'junior_admin']
    },

    audit: {
      label: 'Auditoria',
      icon: '🔍',
      module: 'OSA_AUDIT',
      method: 'renderLog',
      roles: ['admin', 'junior_admin']
    },

    settings: {
      label: 'Configurações',
      icon: '⚙️',
      module: 'OSA_SETTINGS',
      method: 'renderSettings',
      roles: ['admin']
    },

    diagnostics: {
      label: 'Diagnóstico',
      icon: '🩺',
      module: 'OSA_DIAGNOSTICS',
      method: 'renderDiagnostics',
      roles: ['admin']
    }
  };

  let currentModule = 'dashboard';
  let sidebarCollapsed = false;

  function getVisibleModules() {
    const role = OSA_AUTH.getRole();

    if (!role) return [];

    return Object.entries(MODULES)
      .filter(([_, cfg]) => cfg.roles.includes(role))
      .map(([key, cfg]) => ({
        key,
        ...cfg
      }));
  }

  function navigate(moduleKey) {
    if (!MODULES[moduleKey]) return;

    const cfg = MODULES[moduleKey];
    const role = OSA_AUTH.getRole();

    if (!cfg.roles.includes(role)) {
      OSA_UI.notifyError('Sem permissão para aceder a este módulo');
      return;
    }

    currentModule = moduleKey;

    // Atualizar item ativo
    document.querySelectorAll('.osa-sidebar__link').forEach(el => {
      el.classList.toggle(
        'osa-sidebar__link--active',
        el.dataset.module === moduleKey
      );
    });

    // Atualizar título
    const titleEl = document.getElementById('osa-topbar-title');

    if (titleEl) {
      titleEl.textContent = cfg.label;
    }

    // ---------------------------------------------------------
    // Obter módulo através do registro global
    // ---------------------------------------------------------
    const registry = window.OSA_MODULES || {};
    const mod = registry[cfg.module];

    const container = document.getElementById('module-content');

    if (!mod) {
      if (container) {
        container.innerHTML = `
          <div class="osa-alert osa-alert--error">
            Módulo não disponível: ${OSA_UI.escapeHtml(cfg.module)}
          </div>`;
      }

      console.error(
        '[OSA_NAV] Módulo não encontrado:',
        cfg.module,
        'Módulos registrados:',
        Object.keys(registry)
      );

      return;
    }

    if (typeof mod[cfg.method] !== 'function') {
      if (container) {
        container.innerHTML = `
          <div class="osa-alert osa-alert--error">
            Função "${OSA_UI.escapeHtml(cfg.method)}" não encontrada em ${OSA_UI.escapeHtml(cfg.module)}
          </div>`;
      }

      console.error(
        '[OSA_NAV] Método não encontrado:',
        cfg.method,
        'no módulo:',
        cfg.module
      );

      return;
    }

    try {
      mod[cfg.method]('module-content');
    } catch (error) {
      console.error(
        '[OSA_NAV] Erro ao executar módulo:',
        cfg.module,
        error
      );

      if (container) {
        container.innerHTML = `
          <div class="osa-alert osa-alert--error">
            <strong>Erro ao carregar o módulo</strong>
            <p>${OSA_UI.escapeHtml(error.message || 'Erro desconhecido')}</p>
          </div>`;
      }
    }

    // Hash
    if (window.location.hash.replace('#', '') !== moduleKey) {
      window.location.hash = moduleKey;
    }

    // Fechar sidebar no mobile
    if (window.innerWidth < 768) {
      toggleSidebar(true);
    }
  }

  function toggleSidebar(forceClose = false) {
    const sidebar = document.getElementById('osa-sidebar');
    const overlay = document.getElementById('osa-sidebar-overlay');

    if (forceClose) {
      sidebarCollapsed = true;
    } else {
      sidebarCollapsed = !sidebarCollapsed;
    }

    if (!sidebar) return;

    if (window.innerWidth < 768) {
      sidebar.classList.toggle(
        'osa-sidebar--mobile-open',
        !sidebarCollapsed
      );

      if (overlay) {
        overlay.classList.toggle(
          'osa-sidebar-overlay--visible',
          !sidebarCollapsed
        );
      }

    } else {

      sidebar.classList.toggle(
        'osa-sidebar--collapsed',
        sidebarCollapsed
      );

      const content = document.getElementById('osa-main');

      if (content) {
        content.classList.toggle(
          'osa-main--expanded',
          sidebarCollapsed
        );
      }
    }
  }

  function buildSidebar() {
    const modules = getVisibleModules();
    const sidebar = document.getElementById('osa-sidebar');

    if (!sidebar) return;

    let html = `
      <div class="osa-sidebar__brand">
        <div class="osa-sidebar__logo">OSA</div>

        <div class="osa-sidebar__title">
          Official Shop<br>Administrator
        </div>

        <button
          class="osa-sidebar__collapse-btn"
          onclick="OSA_NAV.toggleSidebar()"
          title="Recolher"
        >☰</button>
      </div>

      <nav class="osa-sidebar__nav">
    `;

    const groups = {
      main: ['dashboard'],
      sales_group: ['sales', 'sales_history'],
      catalog: ['products', 'categories'],
      stock_group: ['stock', 'transfers', 'inventory'],
      finance: ['cash', 'closings', 'fuel'],
      incidents: ['losses', 'thefts'],
      analytics: ['reports', 'audit'],
      system: ['settings', 'diagnostics']
    };

    const groupLabels = {
      main: '',
      sales_group: 'Vendas',
      catalog: 'Catálogo',
      stock_group: 'Armazém',
      finance: 'Finanças',
      incidents: 'Incidentes',
      analytics: 'Análise',
      system: 'Sistema'
    };

    for (const [groupKey, groupModules] of Object.entries(groups)) {

      const visibleGroupModules = groupModules.filter(
        key => modules.some(m => m.key === key)
      );

      if (!visibleGroupModules.length) continue;

      if (groupLabels[groupKey]) {
        html += `
          <div class="osa-sidebar__group-label">
            ${groupLabels[groupKey]}
          </div>
        `;
      }

      visibleGroupModules.forEach(key => {

        const mod = modules.find(m => m.key === key);

        if (!mod) return;

        html += `
          <a
            href="#${key}"
            class="osa-sidebar__link ${
              currentModule === key
                ? 'osa-sidebar__link--active'
                : ''
            }"
            data-module="${key}"
            onclick="OSA_NAV.navigate('${key}'); return false;"
          >
            <span class="osa-sidebar__icon">${mod.icon}</span>
            <span class="osa-sidebar__text">${mod.label}</span>
          </a>
        `;
      });
    }

    html += '</nav>';

    const user = OSA_AUTH.getCurrentUser();
    const profile = OSA_AUTH.getCurrentProfile();
    const role = OSA_AUTH.getRole();

    html += `
      <div class="osa-sidebar__user">

        <div class="osa-sidebar__user-info">

          <div class="osa-sidebar__user-name">
            ${OSA_UI.escapeHtml(
              profile?.full_name ||
              user?.email ||
              'Utilizador'
            )}
          </div>

          <div class="osa-sidebar__user-role">
            ${OSA_CONFIG.ROLES[role] || role}
          </div>

        </div>

        <button
          class="osa-sidebar__logout"
          onclick="OSA_AUTH.logout()"
          title="Sair"
        >⏻</button>

      </div>
    `;

    sidebar.innerHTML = html;
  }

  function buildTopbar() {
    const topbar = document.getElementById('osa-topbar');

    if (!topbar) return;

    topbar.innerHTML = `
      <button
        class="osa-topbar__menu-btn"
        onclick="OSA_NAV.toggleSidebar()"
      >☰</button>

      <h2
        class="osa-topbar__title"
        id="osa-topbar-title"
      >
        ${MODULES[currentModule]?.label || 'Painel'}
      </h2>

      <div class="osa-topbar__actions">
        <span
          class="osa-topbar__time"
          id="osa-clock"
        ></span>
      </div>
    `;
  }

  function startClock() {
    const update = () => {

      const el = document.getElementById('osa-clock');

      if (!el) return;

      const now = new Date();

      el.textContent = now.toLocaleString(
        'pt-MZ',
        {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }
      );
    };

    update();
    setInterval(update, 1000);
  }

  function init() {

    buildSidebar();
    buildTopbar();
    startClock();

    const hash = window.location.hash.replace('#', '');

    if (hash && MODULES[hash]) {
      navigate(hash);
    } else {
      navigate('dashboard');
    }

    window.addEventListener('hashchange', () => {

      const h = window.location.hash.replace('#', '');

      if (
        h &&
        h !== currentModule &&
        MODULES[h]
      ) {
        navigate(h);
      }
    });
  }

  function getCurrentModule() {
    return currentModule;
  }

  return {
    MODULES,
    getVisibleModules,
    navigate,
    toggleSidebar,
    buildSidebar,
    buildTopbar,
    startClock,
    init,
    getCurrentModule
  };

})();

// Disponibilizar para os onclick="" do HTML
window.OSA_NAV = OSA_NAV;
```
