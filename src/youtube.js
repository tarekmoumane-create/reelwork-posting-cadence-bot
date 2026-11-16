// YouTube has a public feed that needs no login, so uploads are free to detect.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Turn any YouTube profile URL into a channel ID (UC...). */
export async function resolveChannelId(url) {
  const direct = url.match(/youtube\.com\/channel\/(UC[\w-]{22})/i);
  if (direct) return direct[1];
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en' } });
    const html = await res.text();
    const m =
      html.match(/"channelId":"(UC[\w-]{22})"/) ||
      html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) ||
      html.match(/"externalId":"(UC[\w-]{22})"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** @returns {Promise<Array<{postId:string, url:string, at:number, platform:'youtube'}>>} */
export async function fetchYouTubePosts(channelId) {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
  const xml = await res.text();
  const out = [];
  for (const block of xml.split('<entry>').slice(1)) {
    const id = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const published = block.match(/<published>([^<]+)<\/published>/)?.[1];
    if (id && published) out.push({ postId: id, url: `https://www.youtube.com/watch?v=${id}`, at: Date.parse(published), platform: 'youtube' });
  }
  return out;
}
