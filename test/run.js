// Quick self-checks for the pure logic (no Discord connection needed): node test/run.js
import assert from 'node:assert/strict';
import { parseCadence, computeStatus } from '../src/cadence.js';
import { parseProfileLinks, matchesCreator, extractUrls, identify, postIdFromUrl } from '../src/links.js';
import { addPost } from '../src/store.js';

const H = 3600e3;
const cases = {
  daily: 24, 'every day': 24, 'Every 2 days': 48, 'every other day': 48, weekly: 168, 'every week': 168,
  '3x a week': 56, '3 times per week': 56, '3/week': 56, 'twice a week': 84, 'twice a day': 12,
  'every 36 hours': 36, '5 posts a week': 33.6, '2x per day': 12, 'every 1.5 weeks': 252, 'once a week': 168,
};
for (const [input, hours] of Object.entries(cases)) {
  const c = parseCadence(input);
  assert(c, `should parse "${input}"`);
  assert(Math.abs(c.hours - hours) < 0.01, `"${input}" → ${c.hours}h, expected ${hours}h`);
}
for (const bad of ['', 'sometimes', '3', 'every', 'lots']) assert.equal(parseCadence(bad), null, `should reject "${bad}"`);

const { links, bad } = parseProfileLinks('https://www.tiktok.com/@reelwork, instagram.com/reel.work https://youtube.com/@ReelWork notalink');
assert.equal(links.length, 3);
assert.deepEqual(links.map((l) => l.platform), ['tiktok', 'instagram', 'youtube']);
assert.equal(links[0].handle, 'reelwork');
assert.equal(links[1].handle, 'reel.work');
assert.deepEqual(bad, ['https://notalink']);

// Post links from the tracked accounts count...
assert(matchesCreator('https://www.tiktok.com/@reelwork/video/7301234567890', links));
assert(matchesCreator('https://vm.tiktok.com/ZMabc123/', links));
assert(matchesCreator('https://www.instagram.com/reel/C9abcDEF/', links));
assert(matchesCreator('https://www.instagram.com/p/C9abcDEF/?igsh=xyz', links));
assert(matchesCreator('https://youtu.be/dQw4w9WgXcQ', links));
assert(matchesCreator('https://www.youtube.com/shorts/abc123', links));
// ...but someone else's TikTok, a bare profile link, or an untracked platform doesn't.
assert.equal(matchesCreator('https://www.tiktok.com/@someoneelse/video/1', links), null);
assert.equal(matchesCreator('https://www.tiktok.com/@reelwork', links), null);
assert.equal(matchesCreator('https://x.com/reelwork/status/1', links), null);

assert.deepEqual(extractUrls('new one up! https://www.tiktok.com/@reelwork/video/1. and https://a.b/c)'), ['https://www.tiktok.com/@reelwork/video/1', 'https://a.b/c']);

const now = Date.now();
const t = { cadence: { hours: 48, label: 'every 2 days' }, posts: [] };
assert.equal(computeStatus(t, now).state, 'none');
t.posts = [{ at: now - 10 * H }];
assert.equal(computeStatus(t, now).state, 'on_track');
t.posts = [{ at: now - 40 * H }];
assert.equal(computeStatus(t, now).state, 'due_soon');
t.posts = [{ at: now - 50 * H }];
const s = computeStatus(t, now);
assert.equal(s.state, 'overdue');
assert(Math.abs(s.overdueMs - 2 * H) < 1000);
assert.equal(s.postsThisWeek, 1);
assert.equal(s.expectedPerWeek, 3.5);

// Post IDs from dropped links
assert.equal(postIdFromUrl(identify('https://www.tiktok.com/@reelwork/video/7301234567890?is_from_webapp=1')), '7301234567890');
assert.equal(postIdFromUrl(identify('https://www.instagram.com/reel/C9abcDEF/?igsh=xyz')), 'C9abcDEF');
assert.equal(postIdFromUrl(identify('https://youtu.be/dQw4w9WgXcQ')), 'dQw4w9WgXcQ');
assert.equal(postIdFromUrl(identify('https://www.youtube.com/shorts/dQw4w9WgXcQ')), 'dQw4w9WgXcQ');
assert.equal(postIdFromUrl(identify('https://vm.tiktok.com/ZMabc123/')), null);

// Dedup: same post ID, same URL, and auto-detected post merging into a nearby manual entry
const tr = { posts: [] };
assert.equal(addPost(tr, { at: now - H, url: 'https://www.tiktok.com/@a/video/1', platform: 'tiktok', postId: '1', source: 'link' }), true);
assert.equal(addPost(tr, { at: now - H + 5000, url: 'https://www.tiktok.com/@a/video/1', platform: 'tiktok', postId: '1', source: 'auto' }), false, 'same id');
assert.equal(addPost(tr, { at: now - 2 * H, url: 'https://www.tiktok.com/@a/video/1', platform: 'tiktok', source: 'link' }), false, 'same url');
assert.equal(addPost(tr, { at: now - 3 * H, url: null, platform: undefined, source: 'manual' }), true, 'manual /posted');
assert.equal(addPost(tr, { at: now - 3.5 * H, url: 'https://www.tiktok.com/@a/video/2', platform: 'tiktok', postId: '2', source: 'auto' }), false, 'auto merges into nearby manual entry');
assert.equal(tr.posts.length, 2);
assert.equal(tr.posts.find((p) => p.postId === '2').url, 'https://www.tiktok.com/@a/video/2', 'manual entry enriched with url');
assert.equal(addPost(tr, { at: now - 30 * H, url: 'https://www.tiktok.com/@a/video/3', platform: 'tiktok', postId: '3', source: 'auto' }), true, 'far-apart auto post is new');
assert.equal(tr.posts.length, 3);

console.log('All checks passed.');
