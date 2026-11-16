// Periodically asks each platform what the creator has posted and logs
// anything new. YouTube via its free public feed; TikTok + Instagram via
// ScrapeCreators (1 credit per profile per check).
import { addPost, allTrackers, setTracker, getTracker } from './store.js';
import { repost } from './tracker.js';
import { fetchYouTubePosts } from './youtube.js';
import { fetchTikTokPosts, fetchInstagramPosts, hasScrapeCreators, getCreditsRemaining } from './scrapecreators.js';

const BACKFILL_MS = 30 * 24 * 3600e3; // how far back to import history on first sync
const EMOJI = { tiktok: '🎵', instagram: '📸', youtube: '▶️' };
const LABEL = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube' };

async function fetchFor(link) {
  if (link.platform === 'youtube') return link.youtubeChannelId ? fetchYouTubePosts(link.youtubeChannelId) : [];
  if (!hasScrapeCreators() || !link.handle) return [];
  if (link.platform === 'tiktok') return fetchTikTokPosts(link.handle);
  if (link.platform === 'instagram') return fetchInstagramPosts(link.handle);
  return [];
}

export function canAutoDetect(link) {
  if (link.platform === 'youtube') return Boolean(link.youtubeChannelId);
  return (link.platform === 'tiktok' || link.platform === 'instagram') && hasScrapeCreators() && Boolean(link.handle);
}

/**
 * Sync one tracker. Returns the list of newly logged posts.
 * @param {object} opts { announce: post a "new post" line in the channel, backfill: import history }
 */
export async function syncTracker(client, tracker, { announce = true, quiet = false } = {}) {
  const added = [];
  const errors = [];
  const since = Date.now() - BACKFILL_MS;
  for (const link of tracker.links) {
    if (!canAutoDetect(link)) continue;
    try {
      const posts = await fetchFor(link);
      for (const p of posts) {
        if (p.at < since) continue;
        if (addPost(tracker, { ...p, source: 'auto' })) added.push(p);
      }
      link.lastCheckedAt = Date.now();
      link.lastError = null;
    } catch (err) {
      link.lastError = err.message;
      errors.push(`${LABEL[link.platform]}: ${err.message}`);
      if (!quiet) console.warn(`[autodetect] ${tracker.name} ${link.platform}: ${err.message}`);
    }
  }
  if (added.length) {
    tracker.overdueNotifiedFor = null;
    setTracker(tracker.channelId, tracker);
    if (client) {
      const channel = await client.channels.fetch(tracker.channelId).catch(() => null);
      // Only announce genuinely fresh posts (last 24h), not the history import at setup.
      const fresh = added.filter((p) => Date.now() - p.at < 24 * 3600e3).sort((a, b) => b.at - a.at);
      if (announce && tracker.announce !== false && channel && fresh.length) {
        for (const p of fresh.slice(0, 3)) {
          await channel.send(`${EMOJI[p.platform]} New ${LABEL[p.platform]} post detected: ${p.url}`).catch(() => {});
        }
      }
      await repost(client, tracker.channelId).catch(() => {});
    }
  } else {
    setTracker(tracker.channelId, tracker); // persist lastCheckedAt / lastError
  }
  return { added, errors };
}

/** Manual check (slash command or button). Returns a human summary. */
export async function runCheck(client, tracker) {
  const { added, errors } = await syncTracker(client, tracker);
  if (!added.length) await repost(client, tracker.channelId).catch(() => {});
  const credits = getCreditsRemaining();
  return [
    added.length ? `✅ Found ${added.length} new post${added.length === 1 ? '' : 's'}.` : '👀 Nothing new since last check.',
    ...errors.map((e) => `⚠️ ${e}`),
    credits !== null ? `ScrapeCreators credits remaining: ${credits}` : null,
  ].filter(Boolean).join('\n');
}

export async function pollAll(client) {
  for (const tracker of allTrackers()) {
    if (!getTracker(tracker.channelId)) continue; // removed mid-loop
    await syncTracker(client, tracker);
  }
  const credits = getCreditsRemaining();
  if (credits !== null) console.log(`[autodetect] sweep done · ScrapeCreators credits remaining: ${credits}`);
}
