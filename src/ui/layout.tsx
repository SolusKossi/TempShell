import type { PropsWithChildren } from 'hono/jsx';
import { html, raw } from 'hono/html';
import { styles } from './styles.ts';
import { SELECT_UI } from './selectui.ts';

export interface NavItem {
  href: string;
  label: string;
  variant?: 'primary' | 'ghost' | 'plain';
}

type LayoutProps = PropsWithChildren<{
  title: string;
  /** Name in the topbar. */
  brand?: string;
  /** Shown next to the brand, e.g. the session name you are looking at. */
  where?: string;
  nav?: NavItem[];
  script?: string;
  /** Centred single-purpose pages (sign in, join) drop the topbar. */
  bare?: boolean;
}>;

export function Layout({ title, brand = 'TempShell', where, nav, script, bare, children }: LayoutProps) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#121215">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/png" sizes="64x64" href="/favicon.png">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>${title}</title>
<style>${raw(styles)}</style>
</head>
<body>
${bare
  ? ''
  : html`<div class="topbar"><div class="topbar-inner">
      <a class="brand" href="/"><span class="mark"></span>${brand}${where ? html` <span class="where">/ ${where}</span>` : ''}</a>
      ${nav?.length ? raw(`<nav class="nav">${nav.map(navButton).join('')}</nav>`) : ''}
    </div></div>`}
<div class="page${bare ? ' centered' : ''}">
  ${children}
</div>
<script>${raw(SELECT_UI)}</script>
${script ? html`<script>${raw(script)}</script>` : ''}
</body>
</html>`;
}

function navButton(item: NavItem): string {
  const cls = item.variant === 'primary' ? 'btn primary sm' : item.variant === 'plain' ? '' : 'btn ghost sm';
  return `<a class="${cls}" href="${esc(item.href)}">${esc(item.label)}</a>`;
}

export function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Seconds under a minute, because when a command has just arrived the
 * difference between 3s and 40s is the difference between "it worked" and
 * "did that send?". Deliberately no "just now".
 */
export function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Keeps every [data-ts] element counting up without a refresh. */
export const LIVE_TIME = `
function fmtAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}
function tickTimes() {
  document.querySelectorAll('[data-ts]').forEach((el) => {
    el.textContent = fmtAgo(Number(el.dataset.ts));
  });
}
tickTimes();
setInterval(tickTimes, 1000);
`;

/** Shared by every page that has a growing textarea. */
export const AUTOGROW = `
function autogrow(el) {
  if (!el) return;
  const fit = () => { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight + 2, 560) + 'px'; };
  el.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return fit;
}
`;
