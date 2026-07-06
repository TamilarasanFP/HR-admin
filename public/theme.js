// Shared light/dark theme toggle across admin, student, and shared-view pages.
(function () {
  function apply(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('hrtheme', t);
    const b = document.getElementById('theme-btn');
    if (b) b.textContent = t === 'light' ? '🌙' : '☀️';
  }
  const start = localStorage.getItem('hrtheme') || 'dark';
  document.documentElement.setAttribute('data-theme', start); // apply early
  document.addEventListener('DOMContentLoaded', () => {
    apply(document.documentElement.getAttribute('data-theme') || start);
    const b = document.getElementById('theme-btn');
    if (b) b.addEventListener('click', () => apply(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'));
  });
})();
