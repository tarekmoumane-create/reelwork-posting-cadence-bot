// ScrapeCreators client for TikTok + Instagram. Endpoints and field handling
// mirror the Reel Trax project's lib/scrapecreators.ts so both stay in sync.
const BASE = 'https://api.scrapecreators.com';

export function hasScrapeCreators() {
  return Boolean(process.env.SCRAPECREATORS_API_KEY);
}

let creditsRemaining = null;
export function getCreditsRemaining() {
  return creditsRemaining;
}

function pick(obj, paths) {
  for (const path of paths) {
    let cur = obj;
    let ok = true;
    for (const part of path.split('.')) {
      if (cur == null) { ok = false; break; }
      cur = cur[part];
    }
    if (ok && cur != null) return cur;
  }
  return undefined;
}

function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'string' && /^\d+$/.test(v)) v = Number(v);
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const d = Date.parse(v);
  return Number.isNaN(d) ? null : d;
}

async function get(path, params) {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) throw new Error('SCRAPECREATORS_API_KEY not set');
  const res = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, { headers: { 'x-api-key': key } });
  if (!res.ok) throw new Error(`ScrapeCreators ${path} → HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`);
  const data = await res.json();
  if (typeof data?.credits_remaining === 'number') creditsRemaining = data.credits_remaining;
  return data;
}

/** @returns {Promise<Array<{postId:string, url:string, at:number, platform:'tiktok'}>>} */
export async function fetchTikTokPosts(handle) {
  const data = await get('/v3/tiktok/profile/videos', { handle, sort_by: 'latest', trim: 'true' });
  const list = data?.aweme_list ?? data?.data?.aweme_list ?? [];
  const out = [];
  for (const it of list) {
    const id = String(pick(it, ['aweme_id', 'id']) ?? '');
    const at = toMs(pick(it, ['create_time', 'createTime']));
    if (!id || !at) continue;
    const author = pick(it, ['author.unique_id', 'author.uniqueId']) || handle;
    out.push({ postId: id, url: `https://www.tiktok.com/@${author}/video/${id}`, at, platform: 'tiktok' });
  }
  return out;
}

/** @returns {Promise<Array<{postId:string, url:string, at:number, platform:'instagram'}>>} */
export async function fetchInstagramPosts(handle) {
  const data = await get('/v2/instagram/user/posts', { handle });
  let list = pick(data, ['items', 'data.items', 'data', 'posts', 'media']) ?? [];
  if (!Array.isArray(list)) list = [];
  const out = [];
  for (const raw of list) {
    const it = raw?.media ?? raw?.node ?? raw;
    const code = pick(it, ['code', 'shortcode']);
    const id = String(pick(it, ['pk', 'id', 'code', 'shortcode']) ?? '');
    const at = toMs(pick(it, ['taken_at', 'taken_at_timestamp', 'device_timestamp', 'timestamp']));
    if (!id || !at) continue;
    out.push({ postId: code ? String(code) : id, url: code ? `https://www.instagram.com/p/${code}/` : `https://www.instagram.com/${handle}/`, at, platform: 'instagram' });
  }
  return out;
}
