// Tab Numbers — przydziela kartom stabilne, sekwencyjne numery.
// Stan w chrome.storage.session: { next: <kolejny numer>, tabs: {tabId: numer} }.
// Numer żyje tak długo jak karta (nawigacja/przeładowanie go nie zmienia),
// a po zamknięciu karty NIE jest reużywany (licznik tylko rośnie).

let queue = Promise.resolve();

// Wszystkie mutacje stanu przez jedną kolejkę — dwa równoczesne zapytania
// nie mogą dostać tego samego numeru.
function withState(fn) {
  const run = queue.then(async () => {
    const {next = 1, tabs = {}} = await chrome.storage.session.get(['next', 'tabs']);
    const state = {next, tabs};
    const result = await fn(state);
    await chrome.storage.session.set({next: state.next, tabs: state.tabs});
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

function assignNumber(tabId) {
  return withState(state => {
    if (state.tabs[tabId] === undefined) {
      state.tabs[tabId] = state.next;
      state.next += 1;
    }
    return state.tabs[tabId];
  });
}

chrome.tabs.onCreated.addListener(tab => {
  if (tab.id !== undefined && tab.id >= 0) assignNumber(tab.id);
});

chrome.tabs.onRemoved.addListener(tabId => {
  withState(state => { delete state.tabs[tabId]; });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'get-tab-number' && sender.tab && sender.tab.id >= 0) {
    assignNumber(sender.tab.id).then(n => sendResponse({number: n}));
    return true; // odpowiedź asynchroniczna
  }
});

// Karty otwarte zanim wystartował service worker (np. po instalacji
// rozszerzenia albo restarcie przeglądarki) — ponumeruj po kolei okien/kart.
chrome.tabs.query({}).then(tabs => {
  tabs.sort((a, b) => (a.windowId - b.windowId) || (a.index - b.index));
  for (const t of tabs) {
    if (t.id !== undefined && t.id >= 0) assignNumber(t.id);
  }
});
