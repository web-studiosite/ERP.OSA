/**
 * OSA — Categories Module
 */

const OSA_CATEGORIES = (() => {

  async function list() {
    return OSA_DATA.read('categories', { order: { column: 'name', ascending: true } });
  }

  async function get(id) {
    return OSA_DATA.read('categories', { single: true, filter: { column: 'id', value: id } });
  }

  async function create(data) {
    const record = { name: data.name, description: data.description || null };
    const res = await OSA_DATA.create('categories', record);
    if (res.ok) {
      await OSA_DATA.audit('CREATE', 'categories', res.data.id, null, res.data);
      OSA_UI.notifySuccess('Categoria criada');
    } else {
      OSA_UI.showError('Erro ao criar categoria', res);
    }
    return res;
  }

  async function update(id, updates) {
    const oldRes = await get(id);
    if (!oldRes.ok) return oldRes;
    const res = await OSA_DATA.update('categories', id, updates);
    if (res.ok) {
      await OSA_DATA.audit('UPDATE', 'categories', id, oldRes.data, res.data);
      OSA_UI.notifySuccess('Categoria atualizada');
    } else {
      OSA_UI.showError('Erro ao atualizar', res);
    }
    return res;
  }

  async function remove(id) {
    OSA_UI.confirm('Eliminar esta categoria? Produtos associados ficarão sem categoria.', async () => {
      const res = await OSA_DATA.remove('categories', id);
      if (res.ok) {
        await OSA_DATA.audit('DELETE', 'categories', id, null, null);
        OSA_UI.notifySuccess('Categoria eliminada');
        renderList('module-content');
      } else {
        OSA_UI.showError('Erro ao eliminar', res);
      }
    }, { danger: true });
  }

  function renderList(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    OSA_UI.setLoading(containerId, true);

    list().then(res => {
      if (!res.ok) {
        container.innerHTML = `<div class="osa-alert osa-alert--error">${OSA_UI.escapeHtml(res.error)}</div>`;
        return;
      }

      const items = res.data || [];

      let html = `
        <div class="osa-card">
          <div class="osa-card__header osa-card__header--actions">
            <h3>Categorias</h3>
            <button class="osa-btn osa-btn--primary" onclick="OSA_CATEGORIES.renderForm('module-content')">+ Nova Categoria</button>
          </div>
          <div class="osa-card__body">`;

      if (!items.length) {
        html += OSA_UI.emptyState('Nenhuma categoria registada');
      } else {
        html += `<table class="osa-table"><thead><tr><th>Nome</th><th>Descrição</th><th>Criado</th><th>Ações</th></tr></thead><tbody>`;
        items.forEach(c => {
          html += `<tr>
            <td>${OSA_UI.escapeHtml(c.name)}</td>
            <td>${OSA_UI.escapeHtml(c.description || '')}</td>
            <td>${OSA_UI.formatDate(c.created_at)}</td>
            <td>
              <button class="osa-btn osa-btn--sm osa-btn--outline" onclick="OSA_CATEGORIES.renderForm('module-content','${c.id}')">Editar</button>
              <button class="osa-btn osa-btn--sm osa-btn--danger" onclick="OSA_CATEGORIES.remove('${c.id}')">Eliminar</button>
            </td>
          </tr>`;
        });
        html += '</tbody></table>';
      }

      html += '</div></div>';
      container.innerHTML = html;
    });
  }

  async function renderForm(containerId, categoryId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let cat = {};
    if (categoryId) {
      const res = await get(categoryId);
      if (!res.ok) { container.innerHTML = OSA_UI.emptyState('Categoria não encontrada'); return; }
      cat = res.data;
    }

    const isEdit = !!categoryId;
    container.innerHTML = `
      <div class="osa-card">
        <div class="osa-card__header"><h3>${isEdit ? 'Editar' : 'Nova'} Categoria</h3></div>
        <div class="osa-card__body">
          <form id="category-form" class="osa-form">
            <div class="osa-form__group">
              <label>Nome *</label>
              <input type="text" name="name" value="${OSA_UI.escapeHtml(cat.name || '')}" required>
            </div>
            <div class="osa-form__group">
              <label>Descrição</label>
              <textarea name="description" rows="3">${OSA_UI.escapeHtml(cat.description || '')}</textarea>
            </div>
            <div class="osa-form__actions">
              <button type="submit" class="osa-btn osa-btn--primary">${isEdit ? 'Guardar' : 'Criar'}</button>
              <button type="button" class="osa-btn osa-btn--secondary" onclick="OSA_CATEGORIES.renderList('module-content')">Cancelar</button>
            </div>
          </form>
        </div>
      </div>`;

    document.getElementById('category-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = { name: fd.get('name'), description: fd.get('description') };

      const btn = e.target.querySelector('[type=submit]');
      OSA_UI.setButtonLoading(btn, true);

      if (isEdit) await update(categoryId, data); else await create(data);

      OSA_UI.setButtonLoading(btn, false);
      renderList('module-content');
    };
  }

  return { list, get, create, update, remove, renderList, renderForm };
})();
