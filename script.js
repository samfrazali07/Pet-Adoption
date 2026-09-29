'use strict';

(() => {
  // ===== Constants =====
  const STORAGE_KEY = 'adoption-interest-queue.v1';
  const ANIMAL_TYPES = ['Dog', 'Cat', 'Rabbit', 'Other'];
  const FIELDS = ['name', 'contact', 'animal', 'type', 'otherType', 'notes'];

  const STATUS = {
    waiting: { label: 'Waiting', next: 'contacted', action: 'Mark contacted' },
    contacted: { label: 'Contacted', next: 'completed', action: 'Mark completed' },
    completed: { label: 'Completed', next: 'waiting', action: 'Move back to waiting' },
  };

  const NAME_RE = /^\p{L}[\p{L} .'-]{1,59}$/u;
  const ANIMAL_RE = /^[\p{L}\p{N}][\p{L}\p{N} .'-]{1,39}$/u;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const PHONE_RE = /^\+?[\d\s()-]+$/;

  // ===== State (single source of truth) =====
  const state = {
    entries: [],
    phase: 'loading', // 'loading' | 'ready' | 'error'
    query: '',
    filter: 'all',
    saving: false,
    simulateFailure: false,
  };

  // ===== DOM references =====
  const $ = (id) => document.getElementById(id);
  const form = $('interest-form');
  const submitBtn = $('submit-btn');
  const formSummary = $('form-summary');
  const queueRegion = $('queue-region');
  const queueTitle = $('queue-title');
  const queueBody = $('queue-body');
  const resultCount = $('result-count');
  const savingEl = $('saving');
  const statusMsg = $('status-msg');
  const alertMsg = $('alert-msg');
  const offlineBanner = $('offline-banner');
  const searchInput = $('search');
  const filterSelect = $('filter');
  const simulateFail = $('simulate-fail');

  // ===== Telemetry simulation =====
  const track = (action) => {
    console.log(`[Analytics] User interacted with Adoption Interest Queue (${action})`);
  };

  // ===== Security: sanitize text before it enters state =====
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  const sanitizeText = (value) =>
    String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[&<>"'`]/g, (ch) => ESCAPES[ch]);

  // Stored values are already escaped, so raw markup characters mean tampered storage.
  const hasRawMarkup = (value) => /[<>"'`]/.test(value);

  const newId = () =>
    window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : `e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // ===== Mock API: simulates a slow / unreliable connection =====
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function simulateNetwork() {
    await wait(500 + Math.random() * 700);
    if (!navigator.onLine) throw new Error('offline');
    if (state.simulateFailure) throw new Error('network');
  }

  const isValidStoredEntry = (e) =>
    e &&
    typeof e.id === 'string' &&
    ['name', 'contact', 'animal', 'type', 'notes'].every((k) => typeof e[k] === 'string' && !hasRawMarkup(e[k])) &&
    Object.prototype.hasOwnProperty.call(STATUS, e.status) &&
    Number.isFinite(e.createdAt);

  const seedEntries = () => {
    const now = Date.now();
    return [
      { id: newId(), name: 'Priya Sharma', contact: 'priya.sharma@example.com', animal: 'Bruno', type: 'Dog', notes: 'Has a fenced yard.', status: 'waiting', createdAt: now - 3 * 3600000 },
      { id: newId(), name: 'Rahul Verma', contact: '+91 90000 00001', animal: 'Mishti', type: 'Cat', notes: '', status: 'contacted', createdAt: now - 2 * 3600000 },
      { id: newId(), name: 'Anita Rao', contact: 'anita.rao@example.com', animal: 'Coco', type: 'Rabbit', notes: 'First-time adopter.', status: 'waiting', createdAt: now - 3600000 },
    ];
  };

  const api = {
    async load() {
      await simulateNetwork();
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) {
        const seeded = seedEntries();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
        return seeded;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return [];
      }
      return Array.isArray(parsed) ? parsed.filter(isValidStoredEntry) : [];
    },
    async save(entries) {
      await simulateNetwork();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    },
  };

  // ===== Validation =====
  function validate(raw) {
    const errors = {};
    const name = raw.name.trim();
    const contact = raw.contact.trim();
    const animal = raw.animal.trim();
    const notes = raw.notes.trim();

    if (!name) errors.name = "Enter the adopter's full name.";
    else if (!NAME_RE.test(name)) errors.name = 'Use 2 to 60 letters, spaces, apostrophes, hyphens or periods.';

    const digits = contact.replace(/\D/g, '');
    const isPhone = PHONE_RE.test(contact) && digits.length >= 10 && digits.length <= 13;
    if (!contact) errors.contact = 'Enter a phone number or email address.';
    else if (!EMAIL_RE.test(contact) && !isPhone) errors.contact = 'Enter a valid email (name@email.com) or a phone number with 10 to 13 digits.';

    if (!animal) errors.animal = 'Enter the name of the animal.';
    else if (!ANIMAL_RE.test(animal)) errors.animal = 'Use 2 to 40 letters, numbers, spaces, apostrophes, hyphens or periods.';

    if (!ANIMAL_TYPES.includes(raw.type)) errors.type = 'Select an animal type.';
    if (raw.type === 'Other') {
      if (!raw.otherType.trim()) errors.otherType = 'Enter the animal type.';
      else if (!ANIMAL_RE.test(raw.otherType.trim())) errors.otherType = 'Use 2 to 40 letters, numbers, spaces, apostrophes, hyphens or periods.';
    }

    if (notes.length > 200) errors.notes = 'Notes must be 200 characters or fewer.';

    return errors;
  }

  function showFieldErrors(errors) {
    let firstInvalid = null;
    let count = 0;
    FIELDS.forEach((key) => {
      const domKey = key === 'otherType' ? 'other-type' : key;
      const input = $(`f-${domKey}`);
      const message = errors[key];
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
      $(`e-${domKey}`).textContent = message ? `Error: ${message}` : '';
      if (message) {
        count += 1;
        if (!firstInvalid) firstInvalid = input;
      }
    });

    if (count > 0) {
      formSummary.textContent = `Please fix ${count} ${count === 1 ? 'field' : 'fields'} before submitting.`;
      formSummary.hidden = false;
      firstInvalid.focus();
    } else {
      formSummary.hidden = true;
      formSummary.textContent = '';
    }
  }

  // ===== Notices =====
  function notify(message) {
    alertMsg.textContent = '';
    statusMsg.textContent = message;
  }

  function notifyError(message) {
    statusMsg.textContent = '';
    alertMsg.textContent = message;
  }

  const failureMessage = (err) =>
    err && err.message === 'offline'
      ? 'You are offline. Reconnect and try again.'
      : 'Connection problem. Your change was not saved. Please try again.';

  function updateConnectivity() {
    offlineBanner.hidden = navigator.onLine;
  }

  // ===== Rendering =====
  const dateFormat = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  const sortedEntries = () => [...state.entries].sort((a, b) => a.createdAt - b.createdAt);

  function renderStats() {
    ['waiting', 'contacted', 'completed'].forEach((status) => {
      $(`stat-${status}`).textContent = String(state.entries.filter((e) => e.status === status).length);
    });
  }

  function stateBox(title, text, buttonHtml) {
    return `<div class="state-box"><h3>${title}</h3><p>${text}</p>${buttonHtml || ''}</div>`;
  }

  function entryHtml(entry, position) {
    const s = STATUS[entry.status];
    const typeLabel = entry.type === 'Other' && entry.otherType ? entry.otherType : entry.type;
    const pos = position ? `<span aria-hidden="true">#${position}</span><small>in line</small>` : '<span aria-hidden="true">–</span>';
    const posLabel = position ? `Position ${position} in line` : 'Not in line';
    return `
      <li class="entry">
        <div class="entry__pos"><span aria-label="${posLabel}" role="img">${pos}</span></div>
        <div>
          <h3>${entry.name} <span class="badge badge--${entry.status}">${s.label}</span></h3>
          <p class="entry__meta">Interested in <strong>${entry.animal}</strong> (${typeLabel})</p>
          <p class="entry__meta">Contact: ${entry.contact}</p>
          ${entry.notes ? `<p class="entry__notes">Notes: ${entry.notes}</p>` : ''}
          <p class="entry__date">Added ${dateFormat.format(new Date(entry.createdAt))}</p>
        </div>
        <div class="entry__actions">
          <button type="button" class="btn" data-action="advance" data-id="${entry.id}" aria-label="${s.action}: ${entry.name}">${s.action}</button>
          <button type="button" class="btn" data-action="remove" data-id="${entry.id}" aria-label="Remove ${entry.name} from queue">Remove</button>
        </div>
      </li>`;
  }

  function renderQueue() {
    queueRegion.setAttribute('aria-busy', String(state.phase === 'loading' || state.saving));
    renderStats();

    if (state.phase === 'loading') {
      queueBody.innerHTML = '<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span><span>Loading adoption queue…</span></div>';
      resultCount.textContent = '';
      return;
    }

    if (state.phase === 'error') {
      queueBody.innerHTML = stateBox(
        "Couldn't load the queue",
        'Check your internet connection and try again.',
        '<button type="button" class="btn btn--primary" data-action="retry">Retry</button>'
      );
      resultCount.textContent = '';
      return;
    }

    const all = sortedEntries();
    const waitingPositions = new Map();
    all.filter((e) => e.status === 'waiting').forEach((e, i) => waitingPositions.set(e.id, i + 1));

    const q = sanitizeText(state.query).toLowerCase();
    const visible = all.filter((e) => {
      const matchesFilter = state.filter === 'all' || e.status === state.filter;
      const matchesQuery = !q || [e.name, e.animal, e.contact, e.type].join(' ').toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });

    resultCount.textContent = `Showing ${visible.length} of ${all.length} ${all.length === 1 ? 'entry' : 'entries'}`;

    if (visible.length === 0) {
      if (all.length === 0) {
        queueBody.innerHTML = stateBox('No data found', 'The queue is empty. Add the first adoption interest using the form.');
      } else {
        const what = q ? `No entries match “${sanitizeText(state.query)}”.` : 'No entries have this status.';
        queueBody.innerHTML = stateBox('No data found', what, '<button type="button" class="btn" data-action="clear">Clear search and filter</button>');
      }
      return;
    }

    queueBody.innerHTML = `<ul class="entries">${visible.map((e) => entryHtml(e, waitingPositions.get(e.id))).join('')}</ul>`;
  }

  // ===== Saving helper (shows loading indicator, handles failure) =====
  function setSaving(flag, fromForm) {
    state.saving = flag;
    savingEl.hidden = !flag;
    submitBtn.disabled = flag;
    submitBtn.textContent = fromForm && flag ? 'Saving…' : 'Add to queue';
    queueRegion.setAttribute('aria-busy', String(flag));
  }

  async function commit(nextEntries, options) {
    if (state.saving) return false;
    setSaving(true, options.fromForm);
    try {
      await api.save(nextEntries);
      state.entries = nextEntries;
      notify(options.message);
      track(options.action);
      renderQueue();
      return true;
    } catch (err) {
      notifyError(failureMessage(err));
      return false;
    } finally {
      setSaving(false, options.fromForm);
    }
  }

  // ===== Event handlers =====
  async function loadQueue() {
    state.phase = 'loading';
    renderQueue();
    try {
      state.entries = await api.load();
      state.phase = 'ready';
    } catch {
      state.phase = 'error';
    }
    renderQueue();
  }

  const otherTypeField = $('other-type-field');
  const otherTypeInput = $('f-other-type');
  $('f-type').addEventListener('change', () => {
    const isOther = $('f-type').value === 'Other';
    otherTypeField.hidden = !isOther;
    otherTypeInput.required = isOther;
    if (!isOther) otherTypeInput.value = '';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.saving) return;

    const raw = {
      name: $('f-name').value,
      contact: $('f-contact').value,
      animal: $('f-animal').value,
      type: $('f-type').value,
      otherType: $('f-other-type').value,
      notes: $('f-notes').value,
    };

    const errors = validate(raw);
    showFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const entry = {
      id: newId(),
      name: sanitizeText(raw.name),
      contact: sanitizeText(raw.contact),
      animal: sanitizeText(raw.animal),
      type: raw.type,
      otherType: raw.type === 'Other' ? sanitizeText(raw.otherType) : '',
      notes: sanitizeText(raw.notes),
      status: 'waiting',
      createdAt: Date.now(),
    };

    const ok = await commit([...state.entries, entry], {
      message: `${entry.name} was added to the queue.`,
      action: 'added interest',
      fromForm: true,
    });

    if (ok) {
      form.reset();
      otherTypeField.hidden = true;
      otherTypeInput.required = false;
      showFieldErrors({});
      $('f-name').focus();
    }
  });

  // Clear a field's error as soon as the user edits it
  FIELDS.forEach((key) => {
    const domKey = key === 'otherType' ? 'other-type' : key;
    const input = $(`f-${domKey}`);
    const clear = () => {
      input.setAttribute('aria-invalid', 'false');
      $(`e-${domKey}`).textContent = '';
    };
    input.addEventListener('input', clear);
    input.addEventListener('change', clear);
  });

  queueBody.addEventListener('click', async (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;

    if (action === 'retry') {
      loadQueue();
      return;
    }

    if (action === 'clear') {
      state.query = '';
      state.filter = 'all';
      searchInput.value = '';
      filterSelect.value = 'all';
      renderQueue();
      searchInput.focus();
      return;
    }

    const entry = state.entries.find((e) => e.id === id);
    if (!entry) return;

    if (action === 'advance') {
      const next = STATUS[entry.status].next;
      const nextEntries = state.entries.map((e) => (e.id === id ? { ...e, status: next } : e));
      const ok = await commit(nextEntries, {
        message: `${entry.name} is now ${STATUS[next].label.toLowerCase()}.`,
        action: `status changed to ${next}`,
      });
      if (ok) {
        const again = queueBody.querySelector(`button[data-action="advance"][data-id="${id}"]`);
        if (again) again.focus();
        else queueTitle.focus();
      }
    }

    if (action === 'remove') {
      if (!window.confirm('Remove this entry from the queue? This cannot be undone.')) return;
      const ok = await commit(state.entries.filter((e) => e.id !== id), {
        message: `${entry.name} was removed from the queue.`,
        action: 'removed entry',
      });
      if (ok) queueTitle.focus();
    }
  });

  searchInput.addEventListener('input', () => {
    state.query = searchInput.value;
    renderQueue();
  });

  filterSelect.addEventListener('change', () => {
    state.filter = filterSelect.value;
    renderQueue();
  });

  simulateFail.addEventListener('change', () => {
    state.simulateFailure = simulateFail.checked;
  });

  window.addEventListener('online', updateConnectivity);
  window.addEventListener('offline', updateConnectivity);

  // ===== Boot =====
  updateConnectivity();
  loadQueue();
})();

