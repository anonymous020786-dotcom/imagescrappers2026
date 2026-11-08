// Inline SVG icons (stroke icons share one base).
import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { strokeWidth?: number };

function Stroke({ children, strokeWidth = 2, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const SunIcon = (p: IconProps) => (
  <Stroke {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Stroke>
);
export const MoonIcon = (p: IconProps) => <Stroke {...p}><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" /></Stroke>;
export const MonitorIcon = (p: IconProps) => <Stroke {...p}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></Stroke>;
export const MenuIcon = (p: IconProps) => <Stroke {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Stroke>;
export const DownloadIcon = (p: IconProps) => <Stroke {...p}><path d="M12 3v12m0 0l-5-5m5 5l5-5M4 21h16" /></Stroke>;
export const CheckIcon = (p: IconProps) => <Stroke strokeWidth={2.5} {...p}><path d="M5 12l5 5L20 7" /></Stroke>;
export const ChevronIcon = (p: IconProps) => <Stroke strokeWidth={2.5} {...p}><path d="M9 6l6 6-6 6" /></Stroke>;
export const ArrowIcon = (p: IconProps) => <Stroke {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Stroke>;
export const SearchIcon = (p: IconProps) => <Stroke {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></Stroke>;
export const FilterIcon = (p: IconProps) => <Stroke {...p}><path d="M3 5h18l-7 8v6l-4-2v-4z" /></Stroke>;
export const GlobeIcon = (p: IconProps) => <Stroke {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" /></Stroke>;
export const EditIcon = (p: IconProps) => <Stroke {...p}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13 7l4 4" /></Stroke>;
export const ChartIcon = (p: IconProps) => <Stroke {...p}><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></Stroke>;
export const LockIcon = (p: IconProps) => <Stroke {...p}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></Stroke>;
export const InfoIcon = (p: IconProps) => <Stroke {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></Stroke>;
export const TextIcon = (p: IconProps) => <Stroke {...p}><path d="M4 7V4h16v3M9 20h6M12 4v16" /></Stroke>;
export const FileIcon = (p: IconProps) => <Stroke {...p}><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M14 3v6h6" /></Stroke>;
export const ShareIcon = (p: IconProps) => (
  <Stroke {...p}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></Stroke>
);
export const BracesIcon = (p: IconProps) => (
  <Stroke {...p}><path d="M8 3H6a2 2 0 00-2 2v4a2 2 0 01-2 2 2 2 0 012 2v4a2 2 0 002 2h2M16 3h2a2 2 0 012 2v4a2 2 0 002 2 2 2 0 00-2 2v4a2 2 0 01-2 2h-2" /></Stroke>
);
export const GithubIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M12 .5a12 12 0 00-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 016 0C17.3 4.7 18.3 5 18.3 5c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0012 .5z" />
  </svg>
);
