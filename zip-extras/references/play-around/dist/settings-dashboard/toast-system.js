(() => {
  const region = document.querySelector('#toast-region');
  if (!region) return;

  const closeMs = 250;
  const defaults = {
    success: { title: 'Success', duration: 4500 },
    error: { title: 'Something went wrong', duration: 6500 },
    warning: { title: 'Check this action', duration: 6000 },
    info: { title: 'Information', duration: 5000 },
    loading: { title: 'Working…', duration: 0 }
  };
  const records = new Map();
  let sequence = 0;

  const paths = {
    success: '<path d="m4 10 4 4 8-9"/>',
    error: '<path d="m6 6 8 8m0-8-8 8"/>',
    warning: '<path d="M10 3 18 17H2L10 3Z"/><path d="M10 8v4m0 2.5h.01"/>',
    info: '<circle cx="10" cy="10" r="8"/><path d="M10 9v5m0-8h.01"/>',
    close: '<path d="m5 5 10 10m0-10L5 15"/>'
  };

  function svg(body, viewBox = '0 0 20 20') {
    return `<svg class="svg-icon" aria-hidden="true" viewBox="${viewBox}">${body}</svg>`;
  }

  function normalize(input) {
    const value = typeof input === 'string' ? { message: input } : { ...input };
    value.type = defaults[value.type] ? value.type : 'info';
    value.title = value.title || defaults[value.type].title;
    value.duration = value.duration ?? defaults[value.type].duration;
    value.progress = Number.isFinite(value.progress) ? Math.min(100, Math.max(0, value.progress)) : null;
    return value;
  }

  function iconMarkup(type) {
    if (type === 'loading') return '<span class="product-toast-spinner" aria-hidden="true"></span>';
    return svg(paths[type] || paths.info);
  }

  function contentMarkup(record) {
    const value = record.value;
    const action = value.actionLabel ? `<button class="product-toast-action" type="button" data-toast-action>${esc(value.actionLabel)}</button>` : '';
    const progress = value.progress !== null ? `<span class="product-toast-progress" aria-hidden="true"><span style="--toast-progress:${value.progress}%"></span></span>` : '';
    return `<span class="product-toast-icon">${iconMarkup(value.type)}</span><div class="product-toast-copy"><strong class="product-toast-title">${esc(value.title)}</strong>${value.message ? `<p class="product-toast-message">${esc(value.message)}</p>` : ''}${action}</div><button class="product-toast-close" type="button" data-toast-close aria-label="Dismiss notification">${svg(paths.close)}</button>${progress}`;
  }

  function schedule(record) {
    clearTimeout(record.timer);
    record.timer = 0;
    if (record.value.duration > 0) record.timer = window.setTimeout(() => dismiss(record.id), record.value.duration);
  }

  function dismiss(id) {
    const record = records.get(id);
    if (!record || record.closing) return;
    record.closing = true;
    clearTimeout(record.timer);
    record.node.classList.remove('is-open');
    window.setTimeout(() => {
      record.node.remove();
      records.delete(id);
    }, closeMs);
  }

  function push(input) {
    const value = normalize(input);
    const id = value.id || `toast-${Date.now()}-${++sequence}`;
    if (records.has(id)) return update(id, value);
    const node = document.createElement('article');
    node.className = 'product-toast t-toast';
    node.dataset.type = value.type;
    node.setAttribute('role', value.type === 'error' ? 'alert' : 'status');
    node.setAttribute('aria-atomic', 'true');
    const record = { id, node, value, timer: 0, closing: false };
    node.innerHTML = contentMarkup(record);
    node.addEventListener('click', event => {
      if (event.target.closest('[data-toast-close]')) dismiss(id);
      if (event.target.closest('[data-toast-action]')) {
        const current = record.value;
        current.onAction?.();
        if (current.dismissOnAction !== false) dismiss(id);
      }
    });
    records.set(id, record);
    region.append(node);
    while (records.size > 5) dismiss(records.keys().next().value);
    requestAnimationFrame(() => node.classList.add('is-open'));
    schedule(record);
    return id;
  }

  function update(id, next) {
    const record = records.get(id);
    if (!record) return push({ ...next, id });
    record.value = normalize({ ...record.value, ...next, id });
    record.closing = false;
    record.node.dataset.type = record.value.type;
    record.node.setAttribute('role', record.value.type === 'error' ? 'alert' : 'status');
    record.node.innerHTML = contentMarkup(record);
    record.node.classList.add('is-open');
    schedule(record);
    return id;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  window.productToast = { push, update, dismiss, clear: () => [...records.keys()].forEach(dismiss) };
})();
