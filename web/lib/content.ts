// Reads the guides (content/guides/*.md), the Help Center (content/help.md) and PRIVACY.md at build time.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { plainText } from './markdown';

const CONTENT = join(process.cwd(), 'content');

export type Page = {
  title: string;
  description: string;
  slug: string;
  updated: string;
  published?: string;
  order?: string;
  tag?: string;
  minutes?: string;
  heading?: string;
  body: string;
};

// "---" front matter of key: value lines, then the Markdown body.
function readContent(path: string): Page {
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`${path}: missing front matter`);
  const meta = Object.fromEntries(
    m[1].split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]),
  );
  for (const key of ['title', 'description', 'slug', 'updated']) if (!meta[key]) throw new Error(`${path}: front matter needs "${key}"`);
  return { ...(meta as Omit<Page, 'body'>), body: m[2] };
}

export function getGuides(): Page[] {
  return readdirSync(join(CONTENT, 'guides'))
    .filter((n) => n.endsWith('.md'))
    .map((n) => readContent(join(CONTENT, 'guides', n)))
    .sort((a, b) => Number(a.order ?? 99) - Number(b.order ?? 99));
}

export const getGuide = (slug: string) => getGuides().find((g) => g.slug === slug);
export const getHelp = () => readContent(join(CONTENT, 'help.md'));
export const getPrivacyMarkdown = () => readFileSync(join(process.cwd(), '..', 'PRIVACY.md'), 'utf8');

// Every "### question" and the text under it becomes a FAQPage entry.
export function faqFrom(markdown: string) {
  return [...markdown.replace(/\r\n/g, '\n').matchAll(/^### (.+)\n([\s\S]*?)(?=^#{2,3} |(?![\s\S]))/gm)].map((m) => ({
    '@type': 'Question',
    name: plainText(m[1]),
    acceptedAnswer: { '@type': 'Answer', text: plainText(m[2]) },
  }));
}

export const humanDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
