// Applies the saved light/dark choice before the page paints (no flash). "system" follows the OS.
try {
  const theme = localStorage.getItem('theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  /* storage blocked: follow the system theme */
}
