// Prompt for user name on first load and store in localStorage, blocking until set
async function ensureKanbanUserName() {
  let name = localStorage.getItem('kanbanUserName');
  if (!name) {
    return new Promise(resolve => {
      const modalHtml = `
        <h2>Enter Your Name</h2>
        <form id="kanban-user-name-form">
          <input name="userName" id="kanban-user-name-input" maxlength="32" placeholder="Your name" required style="width:100%;padding:0.7em 1em;font-size:1.1em;border-radius:6px;border:1.2px solid var(--accent);background:#10131b;color:var(--text-main);margin-bottom:1.2em;" autocomplete="off" />
          <button type="submit" style="width:100%;background:var(--accent);color:#10131b;border:none;border-radius:6px;padding:0.7em 0;font-size:1.1em;font-family:'Orbitron','Segoe UI',Arial,sans-serif;font-weight:700;cursor:pointer;box-shadow:0 1px 8px #00f7ff22;">Continue</button>
        </form>
      `;
      const closeModal = showKanbanModal(modalHtml, null);
      document.getElementById('kanban-user-name-form').onsubmit = function(ev) {
        ev.preventDefault();
        const val = document.getElementById('kanban-user-name-input').value.trim();
        if (val) {
          localStorage.setItem('kanbanUserName', val);
          closeModal();
          resolve(val);
        }
      };
    });
  }
  return name;
}
// Call on page load and block until name is set
if (window.location.pathname.includes('/kanban')) {
  (async () => { await ensureKanbanUserName(); })();
}
// ISP Kanban Board - UI and API integration
const API_URL = '/kanban/api';

async function fetchState() {
  const res = await fetch(API_URL);
  return res.json();
}

async function saveState(state) {
  await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state)
  });
}

function showKanbanModal(contentHtml, onClose) {
  const backdrop = document.getElementById('kanban-modal-backdrop');
  const modal = document.getElementById('kanban-modal');
  const body = document.getElementById('kanban-modal-body');
  body.innerHTML = contentHtml;
  backdrop.hidden = false;
  modal.hidden = false;
  function closeModal() {
    backdrop.hidden = true;
    modal.hidden = true;
    body.innerHTML = '';
    if (onClose) onClose();
  }
  document.getElementById('kanban-modal-close').onclick = closeModal;
  backdrop.onclick = closeModal;
  return closeModal;
}

function createCardElement(card, colId, colIdx, state, render) {
  const cardDiv = document.createElement('div');
  cardDiv.className = 'kanban-card';
  cardDiv.draggable = true;
  cardDiv.innerHTML = `
    <div class="kanban-card-main">
      <div class="kanban-card-title">${card.title}</div>
      <div class="kanban-card-desc">${card.description || ''}</div>
    </div>
    <div class="kanban-card-hover-right">
      <button class="kanban-card-edit-btn" tabindex="-1" aria-label="Edit card"><span class="kanban-edit-icon">✎</span></button>
    </div>
  `;
  // Card click: open details/edit modal
  cardDiv.onclick = e => {
    // Only open modal if not clicking a button or form, except edit icon
    if (e.target.closest('button.kanban-card-edit-btn') || e.target.closest('form')) {
      // Allow edit icon to open modal
    } else if (e.target.closest('button') || e.target.closest('form')) {
      return;
    }
    const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    function renderCommentsSection() {
      const commentsDiv = document.getElementById('kanban-modal-comments-list');
      commentsDiv.innerHTML = '';
      (card.comments||[]).forEach((c, idx) => {
        const commentEl = document.createElement('div');
        commentEl.className = 'kanban-comment';
        // Support legacy string comments for backward compatibility
        let name = '', text = '';
        if (typeof c === 'string') {
          const match = c.match(/^<b>([^<:]+):<\/b>\s*(.*)$/);
          if (match) {
            name = match[1];
            text = match[2];
          } else {
            text = c;
          }
        } else if (typeof c === 'object' && c !== null) {
          name = c.name || '';
          text = c.text || '';
        }
        const p = document.createElement('p');
        p.style.margin = '0';
        if (name) {
          const b = document.createElement('b');
          b.textContent = name + ': ';
          p.appendChild(b);
        }
        p.appendChild(document.createTextNode(text));
        commentEl.appendChild(p);
        if (isLocalhost) {
          const delBtn = document.createElement('button');
          delBtn.className = 'kanban-comment-delete-btn';
          delBtn.title = 'Delete comment';
          delBtn.innerHTML = '🗑';
          delBtn.onclick = function(e) {
            e.stopPropagation();
            card.comments.splice(idx, 1);
            saveState(state).then(() => { renderCommentsSection(); });
          };
          commentEl.appendChild(delBtn);
        }
        commentsDiv.appendChild(commentEl);
      });
      if (!card.comments || card.comments.length === 0) {
        commentsDiv.innerHTML = '<span class="muted">No comments yet.</span>';
      }
    }

    let modalHtml = `
      <div class="kanban-modal-left">
        <div class="kanban-modal-left-content">
          <h2>${isLocalhost ? 'Edit Card' : 'Card Details'}</h2>
          <form id="kanban-edit-card-form">
            ${isLocalhost ? `
              <label>Title
                <input name="title" value="${card.title.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}" required maxlength="100" />
              </label>
              <label>Description
                <textarea name="description" rows="3" maxlength="500">${(card.description||'').replace(/</g,'&lt;')}</textarea>
              </label>
            ` : `
              <label>Title
                <div class="kanban-modal-readonly">${card.title}</div>
              </label>
              <label>Description
                <div class="kanban-modal-readonly">${(card.description||'')}</div>
              </label>
            `}
          </form>
        </div>
        ${isLocalhost ? `
          <div class="kanban-modal-btn-row kanban-modal-btn-row-bottom">
            <button type="submit" form="kanban-edit-card-form">Save</button>
            <button type="submit" id="kanban-delete-card-btn" form="kanban-edit-card-form">Delete</button>
          </div>
        ` : ''}
      </div>
      <div class="kanban-modal-right">
        <div class="kanban-modal-comments-scroll"><div id="kanban-modal-comments-list"></div></div>
        <div class="kanban-modal-add-comment-row">
          <input type="text" id="kanban-modal-add-comment-input" maxlength="200" placeholder="Add a comment..." autocomplete="off" />
          <button type="button" id="kanban-modal-add-comment-btn">Add</button>
        </div>
      </div>
    `;
    const closeModal = showKanbanModal(modalHtml, null);
    renderCommentsSection();
    document.getElementById('kanban-modal-add-comment-btn').onclick = async function(ev) {
      ev.preventDefault();
      const input = document.getElementById('kanban-modal-add-comment-input');
      const val = input.value.trim();
      let name = localStorage.getItem('kanbanUserName');
      if (!name) {
        name = await ensureKanbanUserName();
      }
      if (val && name) {
        card.comments = card.comments || [];
        card.comments.push({ name, text: val });
        input.value = '';
        saveState(state).then(() => { renderCommentsSection(); });
      }
    };
    if (isLocalhost) {
      document.getElementById('kanban-edit-card-form').onsubmit = function(ev) {
        if (ev.submitter && ev.submitter.id === 'kanban-delete-card-btn') {
          ev.preventDefault();
          if (confirm('Delete this card?')) {
            state.columns[colIdx].cards = state.columns[colIdx].cards.filter(c => c.id !== card.id);
            saveState(state).then(() => { closeModal(); render(); });
          }
          return;
        }
        ev.preventDefault();
        card.title = this.title.value;
        card.description = this.description.value;
        saveState(state).then(() => { closeModal(); render(); });
      };
    } else {
      document.getElementById('kanban-edit-card-form').onsubmit = function(ev) {
        ev.preventDefault();
        // Only allow adding comments
      };
    }
  };
  // Edit icon also opens modal
  cardDiv.querySelector('.kanban-card-edit-btn').onclick = e => {
    e.stopPropagation();
    cardDiv.onclick(e);
  };
  // Move left/right
  cardDiv.querySelectorAll('.kanban-move-btn').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      if (btn.dataset.dir === 'left' && colIdx > 0) {
        state.columns[colIdx-1].cards.push(card);
        state.columns[colIdx].cards = state.columns[colIdx].cards.filter(c => c.id !== card.id);
        saveState(state).then(render);
      } else if (btn.dataset.dir === 'right' && colIdx < state.columns.length-1) {
        state.columns[colIdx+1].cards.push(card);
        state.columns[colIdx].cards = state.columns[colIdx].cards.filter(c => c.id !== card.id);
        saveState(state).then(render);
      } else if (btn.dataset.action === 'delete') {
        state.columns[colIdx].cards = state.columns[colIdx].cards.filter(c => c.id !== card.id);
        saveState(state).then(render);
      }
    };
  });
  // Add comment (now only in modal)
  // Drag & drop
  cardDiv.ondragstart = e => {
    e.dataTransfer.setData('text/plain', JSON.stringify({card, colIdx}));
    setTimeout(() => cardDiv.classList.add('dragging'), 0);
  };
  cardDiv.ondragend = () => cardDiv.classList.remove('dragging');
  return cardDiv;
}

function renderKanban(state) {
  const app = document.getElementById('kanban-app');
  app.innerHTML = '';
  state.columns.forEach((col, colIdx) => {
    const colDiv = document.createElement('div');
    colDiv.className = 'kanban-column';
    colDiv.innerHTML = `<div class="kanban-column-header">${col.name}</div>`;
    // Card list wrapper
    const cardList = document.createElement('div');
    cardList.className = 'kanban-card-list';
    col.cards.forEach(card => {
      cardList.appendChild(createCardElement(card, col.id, colIdx, state, () => renderKanban(state)));
    });
    colDiv.appendChild(cardList);
    // Add card
    const addBtn = document.createElement('button');
    addBtn.className = 'kanban-add-card-btn';
    addBtn.textContent = '+ Add Card';
    addBtn.onclick = () => {
      const closeModal = showKanbanModal(`
        <h2>Add Card</h2>
        <form id="kanban-add-card-form">
          <label>Title
            <input name="title" required maxlength="100" />
          </label>
          <label>Description
            <textarea name="description" rows="3" maxlength="500"></textarea>
          </label>
          <button type="submit">Add Card</button>
        </form>
      `, null);
      document.getElementById('kanban-add-card-form').onsubmit = function(ev) {
        ev.preventDefault();
        const title = this.title.value.trim();
        if (title) {
          const description = this.description.value.trim();
          const id = 'card-' + Date.now() + '-' + Math.floor(Math.random()*1000000);
          col.cards.push({ id, title, description, comments: [] });
          saveState(state).then(() => { closeModal(); renderKanban(state); });
        }
      };
    };
    colDiv.appendChild(addBtn);
    // Drag & drop target
    cardList.ondragover = e => e.preventDefault();
    cardList.ondrop = e => {
      e.preventDefault();
      const {card, colIdx: fromIdx} = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (fromIdx !== colIdx) {
        // Remove by id, not object reference
        state.columns[fromIdx].cards = state.columns[fromIdx].cards.filter(c => c.id !== card.id);
        state.columns[colIdx].cards.push(card);
        saveState(state).then(() => renderKanban(state));
      }
    };
    app.appendChild(colDiv);
  });
}

async function main() {
  // Ensure modal is hidden on load
  const backdrop = document.getElementById('kanban-modal-backdrop');
  const modal = document.getElementById('kanban-modal');
  if (backdrop) backdrop.hidden = true;
  if (modal) modal.hidden = true;
  let state = await fetchState();
  window.kanbanState = state;
  renderKanban(state);
}

window.addEventListener('DOMContentLoaded', main);
