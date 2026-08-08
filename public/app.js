// Valet Ticket System — dashboard logic
const $ = (sel) => document.querySelector(sel);
const state = {
  config: { aiEnabled: false, event: { name: '' } },
  tickets: [],
  filter: 'all',
  photos: { front: null, back: null }, // { media_type, data, dataUrl }
};

// ---------- utilities ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    location.href = '/login.html';
    throw new Error('Not authenticated');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${kind}`;
  setTimeout(() => t.classList.add('hidden'), 3200);
}

function fileToPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const [meta, b64] = dataUrl.split(',');
      const media_type = meta.match(/data:(.*?);/)[1];
      resolve({ media_type, data: b64, dataUrl });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- config ----------
async function loadConfig() {
  state.config = await api('/api/config');
  $('#eventName').textContent = state.config.event.name;
  const ai = $('#pillAi');
  ai.textContent = state.config.aiEnabled ? 'AI · live' : 'AI · demo';
  ai.className = 'pill ' + (state.config.aiEnabled ? 'live' : 'mock');
  if (state.config.user) {
    $('#userChip').textContent = '👤 ' + (state.config.user.display_name || state.config.user.username);
  }
}

$('#logoutBtn').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  location.href = '/login.html';
});

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    const name = tab.dataset.tab;
    const panel = $(`#panel-${name}`);
    if (panel) panel.classList.add('active');
  });
});

// ---------- photos ----------
document.querySelectorAll('input[type="file"]').forEach((input) => {
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const slot = input.dataset.slot;
    const photo = await fileToPhoto(file);
    state.photos[slot] = photo;
    const slotEl = $(`#slot-${slot}`);
    slotEl.classList.add('filled');
    slotEl.querySelector('.photo-inner')?.remove();
    slotEl.querySelector('img')?.remove();
    slotEl.querySelector('.photo-badge')?.remove();
    const img = document.createElement('img');
    img.src = photo.dataUrl;
    const badge = document.createElement('span');
    badge.className = 'photo-badge';
    badge.textContent = slot === 'front' ? 'Front' : 'Back';
    slotEl.append(img, badge);
    updateAnalyzeBtn();
  });
});

function updateAnalyzeBtn() {
  const has = state.photos.front || state.photos.back;
  $('#analyzeBtn').disabled = !has;
}

$('#analyzeBtn').addEventListener('click', async () => {
  const photos = [state.photos.front, state.photos.back].filter(Boolean).map((p) => ({
    media_type: p.media_type,
    data: p.data,
  }));
  if (photos.length === 0) return;
  const btn = $('#analyzeBtn');
  btn.disabled = true;
  btn.textContent = 'Analyzing…';
  try {
    const r = await api('/api/analyze', { method: 'POST', body: { photos } });
    if (r.plate) $('#plate').value = r.plate;
    if (r.make_model) $('#make_model').value = r.make_model;
    if (r.color) $('#color').value = r.color;
    const src = r.source === 'ai' ? 'AI' : 'demo data';
    setIntakeMsg(`Filled from ${src}. Review and edit if needed, then create the ticket.`, 'ok');
  } catch (err) {
    setIntakeMsg(err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Analyze with AI';
  }
});

function setIntakeMsg(msg, kind) {
  const el = $('#intakeMsg');
  el.textContent = msg;
  el.className = `inline-msg ${kind || ''}`;
}

// ---------- create ticket ----------
$('#createBtn').addEventListener('click', async () => {
  const phone = $('#phone').value.trim();
  if (!phone) return setIntakeMsg('Enter the owner’s phone number first.', 'err');
  const body = {
    phone,
    plate: $('#plate').value.trim(),
    make_model: $('#make_model').value.trim(),
    color: $('#color').value.trim(),
    notes: $('#notes').value.trim(),
  };
  try {
    const ticket = await api('/api/tickets', { method: 'POST', body });
    toast(`Ticket #${ticket.ticket_number} created`);
    resetIntake();
    await loadTickets();
  } catch (err) {
    setIntakeMsg(err.message, 'err');
  }
});

function resetIntake() {
  ['#phone', '#plate', '#make_model', '#color', '#notes'].forEach((s) => ($(s).value = ''));
  state.photos = { front: null, back: null };
  ['front', 'back'].forEach((slot) => {
    const el = $(`#slot-${slot}`);
    el.classList.remove('filled');
    el.innerHTML = `<input type="file" accept="image/*" capture="environment" data-slot="${slot}" hidden />
      <div class="photo-inner"><span class="photo-plus">+</span><span>${slot === 'front' ? 'Front' : 'Back'}</span></div>`;
    el.querySelector('input').addEventListener('change', reattachFileHandler);
  });
  updateAnalyzeBtn();
  setIntakeMsg('', '');
}

// Re-wire file inputs after reset (they were replaced via innerHTML).
function reattachFileHandler(e) {
  const input = e.target;
  const file = input.files[0];
  if (!file) return;
  fileToPhoto(file).then((photo) => {
    const slot = input.dataset.slot;
    state.photos[slot] = photo;
    const slotEl = $(`#slot-${slot}`);
    slotEl.classList.add('filled');
    slotEl.innerHTML = '';
    const img = document.createElement('img');
    img.src = photo.dataUrl;
    const badge = document.createElement('span');
    badge.className = 'photo-badge';
    badge.textContent = slot === 'front' ? 'Front' : 'Back';
    slotEl.append(img, badge);
    updateAnalyzeBtn();
  });
}

// ---------- tickets list ----------
const STATUS_LABEL = { parked: 'Parked', requested: 'Requested', ready: 'Ready', delivered: 'Delivered' };
const NEXT_STATUS = { parked: 'ready', requested: 'ready', ready: 'delivered', delivered: 'parked' };
const NEXT_LABEL = { parked: 'Mark ready', requested: 'Mark ready', ready: 'Mark delivered', delivered: 'Re-park' };

async function loadTickets() {
  const data = await api('/api/tickets');
  state.tickets = data.tickets;
  $('#ticketCount').textContent = data.tickets.length;
  renderTickets();
}

function renderTickets() {
  const list = $('#ticketList');
  const filtered =
    state.filter === 'all' ? state.tickets : state.tickets.filter((t) => t.status === state.filter);
  $('#emptyState').classList.toggle('hidden', state.tickets.length > 0);
  list.innerHTML = '';

  for (const t of filtered) {
    const car = [t.color, t.make_model].filter(Boolean).join(' ') || 'Vehicle details pending';
    const el = document.createElement('div');
    el.className = `ticket ${t.status}`;
    el.innerHTML = `
      <div class="tnum">${t.ticket_number}</div>
      <div class="tbody">
        <div class="tcar">${escapeHtml(car)}</div>
        <div class="tmeta">
          ${t.plate ? `<span class="plate">${escapeHtml(t.plate)}</span>` : ''}
          <span>📱 ${escapeHtml(t.phone)}</span>
          ${t.notes ? `<span>📝 ${escapeHtml(t.notes)}</span>` : ''}
        </div>
        <div class="tactions">
          <button class="mini" data-act="print" data-token="${t.public_token}">🖨️ Ticket / QR</button>
          <button class="mini" data-act="advance" data-id="${t.id}">${NEXT_LABEL[t.status]}</button>
          <button class="mini danger" data-act="delete" data-id="${t.id}">Remove</button>
        </div>
      </div>
      <div class="tright">
        <span class="badge ${t.status}">${STATUS_LABEL[t.status] || t.status}</span>
      </div>`;
    list.appendChild(el);
  }
}

$('#ticketList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  try {
    if (act === 'print') {
      window.open('/print.html?t=' + encodeURIComponent(btn.dataset.token), '_blank');
      return;
    }
    if (act === 'advance') {
      const ticket = state.tickets.find((t) => String(t.id) === String(id));
      const next = NEXT_STATUS[ticket.status];
      await api(`/api/tickets/${id}`, { method: 'PATCH', body: { status: next } });
      await loadTickets();
    } else if (act === 'delete') {
      if (!confirm('Remove this ticket?')) return;
      await api(`/api/tickets/${id}`, { method: 'DELETE' });
      await loadTickets();
    }
  } catch (err) {
    toast(err.message, 'err');
  }
});

// Filters
document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.filter = chip.dataset.filter;
    renderTickets();
  });
});

// New event
$('#newEventBtn').addEventListener('click', async () => {
  const name = prompt('Name this valet event:', state.config.event.name || 'Valet Event');
  if (name === null) return;
  try {
    await api('/api/events', { method: 'POST', body: { name: name.trim() } });
    await loadConfig();
    await loadTickets();
    toast('New event started — ticket numbers reset to 1');
  } catch (err) {
    toast(err.message, 'err');
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Real-time updates via Server-Sent Events ----------
function connectToUpdates() {
  const eventSource = new EventSource('/api/updates');

  eventSource.addEventListener('ticket_created', () => {
    loadTickets();
  });

  eventSource.addEventListener('ticket_updated', () => {
    loadTickets();
  });

  eventSource.addEventListener('ticket_deleted', () => {
    loadTickets();
  });

  eventSource.addEventListener('error', (err) => {
    console.error('SSE connection error:', err);
    // Automatically reconnects after a delay
    eventSource.close();
    setTimeout(() => connectToUpdates(), 5000);
  });
}

// ---------- init ----------
(async function init() {
  try {
    await loadConfig();
    await loadTickets();
    connectToUpdates(); // Start listening for real-time updates
  } catch (err) {
    toast('Could not load: ' + err.message, 'err');
  }
})();
