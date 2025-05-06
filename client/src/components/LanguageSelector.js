// client/src/components/LanguageSelector.js
// Fetches /config/languages.json and renders <select>.
// Emits a 'language-change' event on <select> when user picks a new one.

export function renderLanguageSelector(parentEl) {
  const select = document.createElement('select');
  select.id = 'langSelect';
  parentEl.appendChild(select);

  // load languages
  fetch('/config/languages.json')
    .then(r => r.json())
    .then(langs => {
      langs.forEach(lang => {
        const opt = document.createElement('option');
        opt.value = lang;
        opt.textContent = lang.toUpperCase();
        select.appendChild(opt);
      });
    });

  // emit event on change
  select.addEventListener('change', () => {
    select.dispatchEvent(new CustomEvent('language-change', { detail: select.value }));
  });

  return select;
}
