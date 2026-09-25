// robots.txt parsing and matching (RFC 9309): longest matching rule wins,
// Allow wins ties, `*` wildcards and `$` end anchors are supported.

export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === 'sitemap') sitemaps.push(value);
    else if ((key === 'allow' || key === 'disallow') && current) {
      // An empty Disallow means "allow everything" and adds no rule.
      if (value) current.rules.push({ allow: key === 'allow', path: value });
    } else if (key === 'crawl-delay' && current) {
      const n = Number(value);
      if (Number.isFinite(n)) current.crawlDelay = n;
    }
  }
  return { groups, sitemaps };
}

function ruleToRegex(path) {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

function groupFor(robots, agent) {
  const name = agent.toLowerCase();
  return (
    robots.groups.find((g) => g.agents.some((a) => a !== '*' && name.includes(a))) ??
    robots.groups.find((g) => g.agents.includes('*')) ??
    null
  );
}

export function isAllowed(robots, url, agent = '*') {
  if (!robots) return true;
  const group = groupFor(robots, agent);
  if (!group) return true;
  let target;
  try {
    const u = new URL(url);
    target = decodeURIComponent(u.pathname) + u.search;
  } catch {
    return true;
  }
  let best = null;
  for (const rule of group.rules) {
    let path = rule.path;
    try {
      path = decodeURIComponent(path);
    } catch { /* keep raw */ }
    if (!ruleToRegex(path).test(target)) continue;
    const len = path.length;
    if (!best || len > best.len || (len === best.len && rule.allow)) best = { len, allow: rule.allow };
  }
  return best ? best.allow : true;
}

export function crawlDelay(robots, agent = '*') {
  return groupFor(robots ?? { groups: [] }, agent)?.crawlDelay ?? 0;
}
