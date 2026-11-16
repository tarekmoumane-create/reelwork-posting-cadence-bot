// Recognises social profile links and post links, so a link dropped in the
// channel can be matched against the creator's tracked accounts.

const PLATFORMS = [
  {
    id: 'tiktok', label: 'TikTok', emoji: '🎵',
    hosts: ['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'],
    handle: /tiktok\.com\/@([\w.-]+)/i,
  },
  {
    id: 'instagram', label: 'Instagram', emoji: '📸',
    hosts: ['instagram.com', 'instagr.am'],
    handle: /instagram\.com\/(?!p\/|reel\/|reels\/|stories\/|explore\/|share\/)([\w.]+)/i,
  },
  {
    id: 'youtube', label: 'YouTube', emoji: '▶️',
    hosts: ['youtube.com', 'youtu.be'],
    handle: /youtube\.com\/(?:@|c\/|user\/)([\w.-]+)/i,
  },
  {
    id: 'x', label: 'X', emoji: '𝕏',
    hosts: ['x.com', 'twitter.com'],
    handle: /(?:x|twitter)\.com\/(?!i\/|home|explore|search)([\w]+)/i,
  },
  {
    id: 'threads', label: 'Threads', emoji: '🧵',
    hosts: ['threads.net', 'threads.com'],
    handle: /threads\.(?:net|com)\/@?([\w.]+)/i,
  },
  {
    id: 'facebook', label: 'Facebook', emoji: '📘',
    hosts: ['facebook.com', 'fb.watch', 'fb.com'],
    handle: /facebook\.com\/(?!reel\/|watch|share\/|photo|video)([\w.]+)/i,
  },
  {
    id: 'linkedin', label: 'LinkedIn', emoji: '💼',
    hosts: ['linkedin.com'],
    handle: /linkedin\.com\/in\/([\w-]+)/i,
  },
  {
    id: 'snapchat', label: 'Snapchat', emoji: '👻',
    hosts: ['snapchat.com'],
    handle: /snapchat\.com\/(?:add\/|@)?([\w.-]+)/i,
  },
  {
    id: 'pinterest', label: 'Pinterest', emoji: '📌',
    hosts: ['pinterest.com', 'pin.it'],
    handle: /pinterest\.com\/(?!pin\/)([\w]+)/i,
  },
];

const URL_RE = /https?:\/\/[^\s<>()\[\]"']+/gi;

export function extractUrls(text) {
  return (text.match(URL_RE) || []).map((u) => u.replace(/[.,;:!?)]+$/, ''));
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  } catch {
    return null;
  }
}

/** @returns {{platform: string, label: string, emoji: string, handle: string|null, url: string} | null} */
export function identify(url) {
  const host = hostOf(url);
  if (!host) return null;
  for (const p of PLATFORMS) {
    if (p.hosts.some((h) => host === h || host.endsWith('.' + h))) {
      const m = url.match(p.handle);
      return { platform: p.id, label: p.label, emoji: p.emoji, handle: m ? m[1].toLowerCase() : null, url };
    }
  }
  return null;
}

/** Parse the comma/space separated links a manager enters at setup. */
export function parseProfileLinks(input) {
  const raw = input.split(/[\s,]+/).filter(Boolean).map((s) => (s.startsWith('http') ? s : `https://${s}`));
  const good = [];
  const bad = [];
  for (const url of raw) {
    const info = identify(url);
    if (info) good.push(info);
    else bad.push(url);
  }
  return { links: good, bad };
}

/**
 * Does a link someone dropped in the channel count as a post by this creator?
 * Rule: same platform as a tracked profile, and if the link carries a handle,
 * it must match the tracked handle (so sharing someone else's TikTok doesn't count).
 * Profile links themselves (no post path) don't count.
 */
export function matchesCreator(url, profiles) {
  const info = identify(url);
  if (!info) return null;
  const tracked = profiles.filter((p) => p.platform === info.platform);
  if (!tracked.length) return null;
  if (isProfileOnly(info)) return null;
  if (info.handle && !tracked.some((p) => p.handle === info.handle)) return null;
  return info;
}

const SHORT_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com', 'youtu.be', 'fb.watch', 'pin.it', 'instagr.am']);

function isProfileOnly(info) {
  try {
    const u = new URL(info.url);
    if (SHORT_HOSTS.has(u.hostname.replace(/^www\./, ''))) return false; // short links always point at a post
    const path = u.pathname.replace(/\/+$/, '');
    const segments = path.split('/').filter(Boolean);
    // e.g. tiktok.com/@name, instagram.com/name, youtube.com/@name -> just a profile
    if (info.platform === 'youtube') return segments.length <= 1 && !u.searchParams.has('v') && u.hostname !== 'youtu.be';
    if (info.platform === 'linkedin') return segments.length <= 2 && segments[0] === 'in';
    return segments.length <= 1;
  } catch {
    return false;
  }
}

/** Platform-specific post ID from a post URL, so a dropped link and an API-detected post dedupe. */
export function postIdFromUrl(info) {
  const u = info.url;
  if (info.platform === 'tiktok') return u.match(/\/video\/(\d+)/)?.[1] || null;
  if (info.platform === 'instagram') return u.match(/\/(?:p|reel|reels)\/([\w-]+)/)?.[1] || null;
  if (info.platform === 'youtube') return u.match(/[?&]v=([\w-]{11})/)?.[1] || u.match(/(?:youtu\.be|shorts)\/([\w-]{11})/)?.[1] || null;
  return null;
}

export function describeProfiles(profiles) {
  return profiles.map((p) => `${p.emoji} [${p.handle ? '@' + p.handle : p.label}](${p.url})`).join(' · ');
}
