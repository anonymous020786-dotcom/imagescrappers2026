// Landing page behaviour: theme switch, mobile menu, header shadow, tabs, reveal-on-scroll and
// download-click events for analytics (see analytics.js). Every part checks its elements exist,
// so the same file works on the home, privacy and 404 pages.
const root = document.documentElement;
root.classList.add('js');

// ------------------------------------------------------------------ theme
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : darkQuery.matches);

function applyTheme(choice) {
  if (choice === 'light' || choice === 'dark') root.dataset.theme = choice;
  else delete root.dataset.theme;
  try {
    if (choice === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', choice);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
  syncThemeControls();
}

function syncThemeControls() {
  const choice = root.dataset.theme || 'system';
  document.querySelectorAll('[data-theme-choice]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === choice)));
  const label = isDark() ? 'Switch to light theme' : 'Switch to dark theme';
  document.querySelectorAll('.theme-toggle').forEach((b) => {
    b.setAttribute('aria-label', label);
    b.title = label;
  });
}

document.querySelectorAll('.theme-toggle').forEach((b) => b.addEventListener('click', () => applyTheme(isDark() ? 'light' : 'dark')));
document.querySelectorAll('[data-theme-choice]').forEach((b) => b.addEventListener('click', () => applyTheme(b.dataset.themeChoice)));
darkQuery.addEventListener?.('change', syncThemeControls);
syncThemeControls();

// ------------------------------------------------------------------ header and menu
const nav = document.querySelector('.nav');
const menuBtn = document.querySelector('.menu-btn');
const setMenu = (open) => {
  nav?.classList.toggle('open', open);
  menuBtn?.setAttribute('aria-expanded', String(open));
  menuBtn?.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
};
menuBtn?.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
document.querySelectorAll('.nav-links a').forEach((a) => a.addEventListener('click', () => setMenu(false)));
document.addEventListener('keydown', (e) => e.key === 'Escape' && setMenu(false));

const header = document.querySelector('.site-header');
const onScroll = () => header?.classList.toggle('scrolled', window.scrollY > 8);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

const year = document.getElementById('year');
if (year) year.textContent = String(new Date().getFullYear());

// ------------------------------------------------------------------ use-case tabs
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab, focus = false) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  }
  if (focus) tab.focus();
}
tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (step) selectTab(tabs[(i + step + tabs.length) % tabs.length], true);
    else if (e.key === 'Home') selectTab(tabs[0], true);
    else if (e.key === 'End') selectTab(tabs[tabs.length - 1], true);
    else return;
    e.preventDefault();
  });
});

// ------------------------------------------------------------------ analytics events
document.querySelectorAll('[data-dl]').forEach((a) =>
  a.addEventListener('click', () => {
    window.dataLayer?.push({ event: 'download_click', browser: a.dataset.dl, link_url: a.href });
  }),
);

// ------------------------------------------------------------------ reveal on scroll
const items = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -60px 0px', threshold: 0.08 },
  );
  items.forEach((el) => io.observe(el));
} else {
  items.forEach((el) => el.classList.add('in'));
}
