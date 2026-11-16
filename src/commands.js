import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { parseCadence, computeStatus, formatDuration, CADENCE_EXAMPLES } from './cadence.js';
import { parseProfileLinks, identify, describeProfiles, postIdFromUrl } from './links.js';
import { getTracker, setTracker, removeTracker, allTrackers, addPost } from './store.js';
import { repost, refresh, buildEmbed } from './tracker.js';
import { resolveChannelId } from './youtube.js';
import { syncTracker, canAutoDetect, runCheck } from './autodetect.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral };

export const definitions = [
  new SlashCommandBuilder()
    .setName('tracker')
    .setDescription('Set up and manage the posting-cadence tracker for this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((sc) =>
      sc
        .setName('setup')
        .setDescription('Start tracking this creator in this channel')
        .addStringOption((o) => o.setName('every').setDescription('How often they should post, e.g. "daily", "3x a week", "every 2 days"').setRequired(true))
        .addStringOption((o) => o.setName('links').setDescription('Their profile links, separated by spaces or commas').setRequired(true))
        .addUserOption((o) => o.setName('creator').setDescription('The creator\'s Discord account (gets pinged when overdue)'))
        .addStringOption((o) => o.setName('name').setDescription('Display name for the card (defaults to the channel name)'))
        .addBooleanOption((o) => o.setName('remind').setDescription('Ping the creator once when they go overdue (default: on)'))
        .addBooleanOption((o) => o.setName('announce').setDescription('Post a line in the channel when a new post is auto-detected (default: on)')),
    )
    .addSubcommand((sc) =>
      sc
        .setName('edit')
        .setDescription('Change the cadence, links, creator or name')
        .addStringOption((o) => o.setName('every').setDescription('New cadence'))
        .addStringOption((o) => o.setName('links').setDescription('Replace the tracked profile links'))
        .addUserOption((o) => o.setName('creator').setDescription('Creator\'s Discord account'))
        .addStringOption((o) => o.setName('name').setDescription('Display name'))
        .addBooleanOption((o) => o.setName('remind').setDescription('Ping when overdue'))
        .addBooleanOption((o) => o.setName('announce').setDescription('Announce auto-detected posts in the channel')),
    )
    .addSubcommand((sc) => sc.setName('remove').setDescription('Stop tracking this channel and delete the card'))
    .addSubcommand((sc) => sc.setName('refresh').setDescription('Re-send the card at the bottom of the channel'))
    .addSubcommand((sc) => sc.setName('check').setDescription('Check the platforms for new posts right now (same as the card button)'))
    .addSubcommand((sc) => sc.setName('undo').setDescription('Remove the most recently logged post (e.g. a mis-detected link)'))
    .addSubcommand((sc) => sc.setName('list').setDescription('Overview of every tracked creator on this server')),

  new SlashCommandBuilder()
    .setName('posted')
    .setDescription('Log a post for this channel\'s creator')
    .addStringOption((o) => o.setName('link').setDescription('Link to the post (optional)'))
    .addStringOption((o) => o.setName('when').setDescription('How long ago, e.g. "2h", "yesterday", "3 days ago" (default: now)')),

  new SlashCommandBuilder().setName('status').setDescription('Show this creator\'s posting status (only you see it)'),
].map((c) => c.toJSON());

// "2h", "3 days ago", "yesterday", "30m" -> timestamp
function parseWhen(input, now = Date.now()) {
  if (!input) return now;
  const s = input.trim().toLowerCase();
  if (s === 'now') return now;
  if (s === 'yesterday') return now - 24 * 3600e3;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|weeks?)(?:\s+ago)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2][0];
  const ms = { m: 60e3, h: 3600e3, d: 86400e3, w: 7 * 86400e3 }[unit];
  return now - n * ms;
}

async function buildLinks(input) {
  const { links, bad } = parseProfileLinks(input);
  for (const l of links) {
    if (l.platform === 'youtube') l.youtubeChannelId = await resolveChannelId(l.url);
  }
  return { links, bad };
}

export async function handle(interaction, client) {
  const { commandName } = interaction;
  const channelId = interaction.channelId;

  if (commandName === 'posted') return handlePosted(interaction, client);
  if (commandName === 'status') return handleStatus(interaction);

  const sub = interaction.options.getSubcommand();

  if (sub === 'setup') {
    if (getTracker(channelId)) {
      return interaction.reply({ content: 'This channel already has a tracker. Use `/tracker edit` to change it or `/tracker remove` first.', ...EPHEMERAL });
    }
    const cadence = parseCadence(interaction.options.getString('every'));
    if (!cadence) {
      return interaction.reply({ content: `I couldn't understand that cadence. Try one of: ${CADENCE_EXAMPLES}`, ...EPHEMERAL });
    }
    await interaction.deferReply(EPHEMERAL);
    const { links, bad } = await buildLinks(interaction.options.getString('links'));
    if (!links.length) {
      return interaction.editReply(`None of those looked like a social profile link. I recognise TikTok, Instagram, YouTube, X, Threads, Facebook, LinkedIn, Snapchat and Pinterest.`);
    }
    const creator = interaction.options.getUser('creator');
    const tracker = {
      guildId: interaction.guildId,
      channelId,
      name: interaction.options.getString('name') || interaction.channel.name.replace(/[-_]/g, ' '),
      creatorId: creator?.id || null,
      remind: interaction.options.getBoolean('remind') ?? true,
      announce: interaction.options.getBoolean('announce') ?? true,
      cadence,
      links,
      posts: [],
      messageId: null,
      lastRenderKey: null,
      overdueNotifiedFor: null,
      createdAt: Date.now(),
    };
    setTracker(channelId, tracker);
    // Pull recent history so the card is accurate from the first second.
    const { added, errors } = await syncTracker(client, tracker, { announce: false, quiet: true });
    await repost(client, channelId);

    const notes = [];
    if (bad.length) notes.push(`⚠️ Skipped (not recognised): ${bad.join(', ')}`);
    const ytMissing = links.filter((l) => l.platform === 'youtube' && !l.youtubeChannelId);
    if (ytMissing.length) notes.push(`⚠️ Couldn't resolve the YouTube channel ID for ${ytMissing.map((l) => l.url).join(', ')}; uploads there won't be auto-detected.`);
    for (const e of errors) notes.push(`⚠️ ${e}`);
    const auto = links.filter(canAutoDetect);
    const manual = links.filter((l) => !canAutoDetect(l));
    const autoNote = [
      auto.length ? `Auto-detected: ${auto.map((l) => l.label).join(', ')} (imported ${added.length} recent post${added.length === 1 ? '' : 's'}).` : null,
      manual.length ? `Manual for ${manual.map((l) => l.label).join(', ')}: drop the post link in this channel or use \`/posted\`.` : null,
    ].filter(Boolean).join(' ');
    return interaction.editReply(
      [`✅ Tracking **${tracker.name}** — cadence **${cadence.label}** (every ${formatDuration(cadence.hours * 3600e3)}).`, `Profiles: ${describeProfiles(links)}`, autoNote, ...notes].join('\n'),
    );
  }

  const tracker = getTracker(channelId);
  if (!tracker && sub !== 'list') {
    return interaction.reply({ content: 'No tracker in this channel yet. Run `/tracker setup` first.', ...EPHEMERAL });
  }

  if (sub === 'edit') {
    await interaction.deferReply(EPHEMERAL);
    const changes = [];
    const every = interaction.options.getString('every');
    if (every) {
      const cadence = parseCadence(every);
      if (!cadence) return interaction.editReply(`I couldn't understand that cadence. Try one of: ${CADENCE_EXAMPLES}`);
      tracker.cadence = cadence;
      tracker.overdueNotifiedFor = null;
      changes.push(`cadence → **${cadence.label}**`);
    }
    const linksIn = interaction.options.getString('links');
    if (linksIn) {
      const { links, bad } = await buildLinks(linksIn);
      if (!links.length) return interaction.editReply('None of those looked like a social profile link, so I left the links unchanged.');
      tracker.links = links;
      changes.push(`links → ${describeProfiles(links)}${bad.length ? ` (skipped: ${bad.join(', ')})` : ''}`);
    }
    const creator = interaction.options.getUser('creator');
    if (creator) {
      tracker.creatorId = creator.id;
      changes.push(`creator → <@${creator.id}>`);
    }
    const name = interaction.options.getString('name');
    if (name) {
      tracker.name = name;
      changes.push(`name → **${name}**`);
    }
    const remind = interaction.options.getBoolean('remind');
    if (remind !== null) {
      tracker.remind = remind;
      changes.push(`overdue pings → ${remind ? 'on' : 'off'}`);
    }
    const announce = interaction.options.getBoolean('announce');
    if (announce !== null) {
      tracker.announce = announce;
      changes.push(`announce new posts → ${announce ? 'on' : 'off'}`);
    }
    if (!changes.length) return interaction.editReply('Nothing to change. Pass at least one option.');
    setTracker(channelId, tracker);
    if (linksIn) await syncTracker(client, tracker, { announce: false, quiet: true });
    await repost(client, channelId);
    return interaction.editReply(`✅ Updated: ${changes.join(' · ')}`);
  }

  if (sub === 'remove') {
    await interaction.deferReply(EPHEMERAL);
    try {
      if (tracker.messageId) {
        const msg = await interaction.channel.messages.fetch(tracker.messageId);
        await msg.delete();
      }
    } catch {
      /* already gone */
    }
    removeTracker(channelId);
    return interaction.editReply('🗑️ Tracker removed for this channel.');
  }

  if (sub === 'refresh') {
    await interaction.deferReply(EPHEMERAL);
    await repost(client, channelId);
    return interaction.editReply('🔄 Card re-sent.');
  }

  if (sub === 'check') {
    await interaction.deferReply(EPHEMERAL);
    return interaction.editReply(await runCheck(client, tracker));
  }

  if (sub === 'undo') {
    if (!tracker.posts.length) return interaction.reply({ content: 'No posts logged yet.', ...EPHEMERAL });
    const removed = tracker.posts.pop();
    tracker.overdueNotifiedFor = null;
    setTracker(channelId, tracker);
    await interaction.deferReply(EPHEMERAL);
    await repost(client, channelId);
    return interaction.editReply(`↩️ Removed the post logged <t:${Math.floor(removed.at / 1000)}:R>${removed.url ? ` (${removed.url})` : ''}.`);
  }

  if (sub === 'list') {
    const trackers = allTrackers().filter((t) => t.guildId === interaction.guildId);
    if (!trackers.length) return interaction.reply({ content: 'No creators are being tracked on this server yet.', ...EPHEMERAL });
    const order = { overdue: 0, due_soon: 1, none: 2, on_track: 3 };
    const icons = { overdue: '🔴', due_soon: '🟡', none: '⚪', on_track: '🟢' };
    const rows = trackers
      .map((t) => ({ t, s: computeStatus(t) }))
      .sort((a, b) => order[a.s.state] - order[b.s.state] || b.s.ratio - a.s.ratio)
      .map(({ t, s }) => {
        const detail =
          s.state === 'none' ? 'no posts yet'
          : s.state === 'overdue' ? `overdue by ${formatDuration(s.overdueMs)}`
          : `due <t:${Math.floor(s.dueAt / 1000)}:R>`;
        return `${icons[s.state]} <#${t.channelId}> **${t.name}** · ${t.cadence.label} · ${detail} · 7d: ${s.postsThisWeek}/${Number.isInteger(s.expectedPerWeek) ? s.expectedPerWeek : s.expectedPerWeek.toFixed(1)}`;
      });
    return interaction.reply({ content: `**Posting cadence overview**\n${rows.join('\n')}`, ...EPHEMERAL });
  }
}

async function handlePosted(interaction, client) {
  const channelId = interaction.channelId;
  const tracker = getTracker(channelId);
  if (!tracker) return interaction.reply({ content: 'No tracker in this channel. A manager can run `/tracker setup`.', ...EPHEMERAL });

  const at = parseWhen(interaction.options.getString('when'));
  if (at === null) return interaction.reply({ content: 'I couldn\'t read that time. Try `2h`, `30m`, `yesterday` or `3 days ago`.', ...EPHEMERAL });

  const link = interaction.options.getString('link')?.trim() || null;
  const info = link ? identify(link) : null;
  const added = addPost(tracker, { at, url: link, source: 'manual', by: interaction.user.id, platform: info?.platform, postId: info ? postIdFromUrl(info) : null });
  if (!added) return interaction.reply({ content: 'That link is already logged.', ...EPHEMERAL });
  tracker.overdueNotifiedFor = null;
  setTracker(channelId, tracker);

  await interaction.reply({ content: `✅ Logged a ${info ? info.label + ' ' : ''}post <t:${Math.floor(at / 1000)}:R> for **${tracker.name}**.`, ...EPHEMERAL });
  await repost(client, channelId);
}

async function handleStatus(interaction) {
  const tracker = getTracker(interaction.channelId);
  if (!tracker) return interaction.reply({ content: 'No tracker in this channel.', ...EPHEMERAL });
  return interaction.reply({ embeds: [buildEmbed(tracker)], ...EPHEMERAL });
}

export { refresh };
