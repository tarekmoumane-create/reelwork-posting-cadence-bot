// Renders the cadence card and keeps it at the bottom of the channel.
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { computeStatus, formatDuration } from './cadence.js';
import { describeProfiles } from './links.js';
import { getTracker, setTracker } from './store.js';

const COLORS = { none: 0x99aab5, on_track: 0x57f287, due_soon: 0xfee75c, overdue: 0xed4245 };
const ICONS = { none: '⚪', on_track: '🟢', due_soon: '🟡', overdue: '🔴' };
const HEADLINE = {
  none: 'No posts logged yet',
  on_track: 'On track',
  due_soon: 'Post due soon',
  overdue: 'Overdue',
};

const ts = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;

function bar(ratio, width = 12) {
  const filled = Math.min(width, Math.max(0, Math.round(ratio * width)));
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

function trimNum(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function buildEmbed(tracker, now = Date.now()) {
  const s = computeStatus(tracker, now);
  const lines = [];

  if (s.state === 'none') {
    lines.push(`${ICONS.none} **${HEADLINE.none}** — drop a post link here or use \`/posted\` to start the clock.`);
  } else {
    const head = s.state === 'overdue'
      ? `${ICONS.overdue} **Overdue by ${formatDuration(s.overdueMs)}**`
      : `${ICONS[s.state]} **${HEADLINE[s.state]}**`;
    lines.push(`${head} · last post ${ts(s.last.at)}`);
    lines.push(s.state === 'overdue' ? `Was due ${ts(s.dueAt)} (${ts(s.dueAt, 'f')})` : `Next post due ${ts(s.dueAt)} (${ts(s.dueAt, 'f')})`);
    lines.push(`\`${bar(s.ratio)}\` ${Math.min(999, Math.round(s.ratio * 100))}% of the window used`);
  }

  lines.push('');
  lines.push(`**Cadence:** ${tracker.cadence.label}`);
  const weekIcon = s.postsThisWeek >= Math.floor(s.expectedPerWeek) ? '✅' : '⚠️';
  lines.push(`**Last 7 days:** ${s.postsThisWeek} / ${trimNum(s.expectedPerWeek)} expected ${weekIcon}`);
  if (tracker.creatorId) lines.push(`**Creator:** <@${tracker.creatorId}>`);
  if (tracker.links.length) lines.push(`**Tracking:** ${describeProfiles(tracker.links)}`);

  const recent = tracker.posts.slice(-3).reverse();
  if (recent.length) {
    lines.push('');
    lines.push('**Recent:** ' + recent.map((p) => (p.url ? `[post](${p.url}) ${ts(p.at)}` : ts(p.at))).join(' · '));
  }

  return new EmbedBuilder()
    .setTitle(`📊 ${tracker.name} — posting cadence`)
    .setColor(COLORS[s.state])
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Drop your post link here or use /posted · Updated' })
    .setTimestamp(now);
}

export function buildComponents(tracker) {
  const canCheck = tracker.links.some((l) => l.platform === 'youtube' ? l.youtubeChannelId : l.handle);
  if (!canCheck) return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`check:${tracker.channelId}`).setLabel('Check now').setEmoji('🔍').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export function cardPayload(tracker) {
  return { embeds: [buildEmbed(tracker)], components: buildComponents(tracker) };
}

/** A cheap fingerprint of what the card looks like; if unchanged, skip the edit. */
export function renderKey(tracker, now = Date.now()) {
  const s = computeStatus(tracker, now);
  return [s.state, Math.round(s.ratio * 12), s.postsThisWeek, tracker.posts.length, Math.floor(s.overdueMs / 3600000)].join(':');
}

async function fetchChannel(client, channelId) {
  try {
    const ch = await client.channels.fetch(channelId);
    return ch?.isTextBased() ? ch : null;
  } catch {
    return null;
  }
}

async function deleteOld(channel, tracker) {
  if (!tracker.messageId) return;
  try {
    const msg = await channel.messages.fetch(tracker.messageId);
    await msg.delete();
  } catch {
    /* already gone */
  }
}

/** Delete the old card and send a fresh one so it sits at the bottom. */
export async function repost(client, channelId) {
  const tracker = getTracker(channelId);
  if (!tracker) return;
  const channel = await fetchChannel(client, channelId);
  if (!channel) return;
  await deleteOld(channel, tracker);
  const msg = await channel.send(cardPayload(tracker));
  tracker.messageId = msg.id;
  tracker.lastRenderKey = renderKey(tracker);
  setTracker(channelId, tracker);
}

/** Edit the card in place (used by the periodic refresh). Falls back to reposting if it's gone. */
export async function refresh(client, channelId, { force = false } = {}) {
  const tracker = getTracker(channelId);
  if (!tracker) return;
  const key = renderKey(tracker);
  if (!force && key === tracker.lastRenderKey && tracker.messageId) return;
  const channel = await fetchChannel(client, channelId);
  if (!channel) return;
  if (tracker.messageId) {
    try {
      const msg = await channel.messages.fetch(tracker.messageId);
      await msg.edit(cardPayload(tracker));
      tracker.lastRenderKey = key;
      setTracker(channelId, tracker);
      return;
    } catch {
      /* deleted by someone: fall through and repost */
    }
  }
  await repost(client, channelId);
}

// Debounced repost: when people chat, wait until it's quiet for a few seconds
// then move the card to the bottom once, instead of after every message.
const pending = new Map();
export function scheduleRepost(client, channelId, delayMs = 6000) {
  clearTimeout(pending.get(channelId));
  pending.set(
    channelId,
    setTimeout(() => {
      pending.delete(channelId);
      repost(client, channelId).catch((err) => console.error(`[tracker] repost failed in ${channelId}:`, err.message));
    }, delayMs),
  );
}

/** Ping the creator once per overdue period, then bring the card back to the bottom. */
export async function checkOverdueReminder(client, tracker) {
  if (!tracker.remind || !tracker.creatorId) return;
  const s = computeStatus(tracker);
  if (s.state !== 'overdue') return;
  const marker = s.last.at;
  if (tracker.overdueNotifiedFor === marker) return;
  const channel = await fetchChannel(client, tracker.channelId);
  if (!channel) return;
  await channel.send(
    `⏰ <@${tracker.creatorId}> heads up: your next post was due ${ts(s.dueAt)} (cadence: ${tracker.cadence.label}). Drop the link here once it's live!`,
  );
  tracker.overdueNotifiedFor = marker;
  setTracker(tracker.channelId, tracker);
  await repost(client, tracker.channelId);
}
