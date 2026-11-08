'use client';
// Light/dark theme. public/theme.js applies the saved choice before the page paints (no flash); these controls
// change it. "system" follows the OS setting. The sun/moon icons switch through CSS, so markup never differs.
import { useCallback, useEffect, useState } from 'react';
import { MonitorIcon, MoonIcon, SunIcon } from './Icons';

type Choice = 'light' | 'dark' | 'system';
const EVENT = 'themechange';

function currentChoice(): Choice {
  const t = document.documentElement.dataset.theme;
  return t === 'light' || t === 'dark' ? t : 'system';
}
const isDark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);

function applyTheme(choice: Choice) {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', choice);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
  window.dispatchEvent(new Event(EVENT));
}

function useTheme() {
  const [state, setState] = useState<{ choice: Choice; dark: boolean }>({ choice: 'system', dark: false });
  useEffect(() => {
    const sync = () => setState({ choice: currentChoice(), dark: isDark() });
    sync();
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', sync);
    window.addEventListener(EVENT, sync);
    return () => {
      media.removeEventListener('change', sync);
      window.removeEventListener(EVENT, sync);
    };
  }, []);
  return state;
}

export function ThemeToggle() {
  const { dark } = useTheme();
  const toggle = useCallback(() => applyTheme(isDark() ? 'light' : 'dark'), []);
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button className="icon-btn theme-toggle" type="button" aria-label={label} title={label} onClick={toggle}>
      <SunIcon className="sun" />
      <MoonIcon className="moon" />
    </button>
  );
}

const CHOICES: { value: Choice; label: string; Icon: typeof SunIcon }[] = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'system', label: 'System', Icon: MonitorIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
];

export function ThemeSwitch() {
  const { choice } = useTheme();
  return (
    <div className="theme-switch" role="group" aria-label="Theme">
      {CHOICES.map(({ value, label, Icon }) => (
        <button key={value} type="button" aria-pressed={choice === value} onClick={() => applyTheme(value)}>
          <Icon />
          {label}
        </button>
      ))}
    </div>
  );
}
