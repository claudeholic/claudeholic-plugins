// Tab Numbers — maintains a "[N] " prefix in the tab title.
// Resilient to SPAs that overwrite the title: observes <title> (and <head>,
// because SPAs can replace the entire element). Own writes are flagged so the
// observer does not re-enter.

(() => {
  let number = null;
  let applying = false;
  let observedTitleEl = null;
  const PREFIX_RE = /^\[\d+\]\s/;

  function stripPrefix(title) {
    return title.replace(PREFIX_RE, '');
  }

  function apply() {
    if (number === null) return;
    const prefix = `[${number}] `;
    const bare = stripPrefix(document.title);
    const want = prefix + bare;
    if (document.title === want) return;
    applying = true;
    try {
      document.title = want;
    } finally {
      applying = false;
    }
  }

  function observeTitleEl() {
    const el = document.querySelector('title');
    if (!el || el === observedTitleEl) return;
    observedTitleEl = el;
    new MutationObserver(() => { if (!applying) apply(); })
      .observe(el, {childList: true, characterData: true, subtree: true});
  }

  chrome.runtime.sendMessage({type: 'get-tab-number'}, resp => {
    if (chrome.runtime.lastError || !resp || resp.number === undefined) return;
    number = resp.number;
    apply();
    observeTitleEl();
    if (document.head) {
      new MutationObserver(() => {
        if (applying) return;
        observeTitleEl();
        apply();
      }).observe(document.head, {childList: true});
    }
  });
})();
