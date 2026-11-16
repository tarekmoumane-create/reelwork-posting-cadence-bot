// Tiny JSON-file store. One process, a handful of channels: no database needed.
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'trackers.json');
const MAX_POSTS = 200;

let state = { channels: {} };

export function load() {
  try {
    state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    state = { channels: {} };
  }
  if (!state.channels) state.channels = {};
  return state;
}

export function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE); // atomic swap so a crash mid-write can't corrupt the file
}

export function getTracker(channelId) {
  return state.channels[channelId] || null;
}

export function setTracker(channelId, tracker) {
  state.channels[channelId] = tracker;
  save();
}

export function removeTracker(channelId) {
  delete state.channels[channelId];
  save();
}

export function allTrackers() {
  return Object.values(state.channels);
}

const MERGE_WINDOW = 6 * 3600e3;

/**
 * Add a post unless it's already logged. Returns true if added.
 * Dedup rules: same platform post ID, or same URL, or (for auto-detected posts)
 * a manual/link entry on the same platform within a few hours that has no ID yet,
 * in which case the existing entry is enriched instead of duplicated.
 */
export function addPost(tracker, post) {
  if (post.postId && tracker.posts.some((p) => p.postId === post.postId && p.platform === post.platform)) return false;
  if (post.url && tracker.posts.some((p) => p.url === post.url)) return false;
  if (post.source === 'auto') {
    const twin = tracker.posts.find((p) => !p.postId && (!p.platform || p.platform === post.platform) && Math.abs(p.at - post.at) < MERGE_WINDOW);
    if (twin) {
      Object.assign(twin, { postId: post.postId, url: twin.url || post.url, platform: post.platform, at: post.at });
      save();
      return false;
    }
  }
  tracker.posts.push(post);
  tracker.posts.sort((a, b) => a.at - b.at);
  if (tracker.posts.length > MAX_POSTS) tracker.posts.splice(0, tracker.posts.length - MAX_POSTS);
  save();
  return true;
}
