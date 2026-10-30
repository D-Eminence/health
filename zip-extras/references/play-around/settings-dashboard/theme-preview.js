(() => {
  const cells = '<i class="theme-mini-cell"></i>'.repeat(8);

  function enhanceThemeControls(root = document) {
    root.querySelectorAll('.theme-preview:not([data-grid-ready])').forEach(preview => {
      preview.dataset.gridReady = 'true';
      preview.innerHTML = `<span class="theme-mini-grid" aria-hidden="true">${cells}</span>`;
    });

    root.querySelectorAll('.radio-mark:not(.t-check)').forEach(mark => {
      const selected = mark.closest('.theme-option')?.classList.contains('selected') || false;
      mark.classList.add('t-check');
      mark.setAttribute('aria-hidden', 'true');
      mark.setAttribute('aria-checked', String(selected));
      mark.innerHTML = '<svg viewBox="0 0 10.1668 10.1668"><path d="M1 5.52L3.92 9.17L9.17 1"/></svg>';
      const path = mark.querySelector('path');
      if (path?.getTotalLength) mark.style.setProperty('--check-len', String(Math.ceil(path.getTotalLength())));
    });
  }

  const observer = new MutationObserver(records => {
    if (records.some(record => record.addedNodes.length)) enhanceThemeControls();
  });

  enhanceThemeControls();
  observer.observe(document.querySelector('#tab-content'), { childList: true, subtree: true });
})();
