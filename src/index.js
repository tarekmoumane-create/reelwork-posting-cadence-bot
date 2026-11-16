import 'dotenv/config';
import { Client, GatewayIntentBits, Events, Partials, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { load, getTracker, setTracker, allTrackers, addPost } from './store.js';
import { extractUrls, matchesCreator, postIdFromUrl } from './links.js';
import { definitions, handle } from './commands.js';
import { scheduleRepost, refresh, checkOverdueReminder } from './tracker.js';
import { pollAll, runCheck } from './autodetect.js';
import { daily, validate } from './schedule.js';
import { hasScrapeCreators } from './scrapecreators.js';

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const REFRESH_EVERY = 5 * 60 * 1000; // re-check status / edit cards
const CHECK_TIME = process.env.CHECK_TIME || '21:00'; // daily platform check, local time in TIMEZONE
const TIMEZONE = process.env.TIMEZONE || 'America/New_York';
try {
  validate(CHECK_TIME, TIMEZONE);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

load();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  try {
    const guildIds = (process.env.GUILD_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (guildIds.length) {
      for (const id of guildIds) {
        await c.application.commands.set(definitions, id);
        console.log(`Registered ${definitions.length} commands to guild ${id}`);
      }
    } else {
      await c.application.commands.set(definitions);
      console.log(`Registered ${definitions.length} global commands (may take a few minutes to appear)`);
    }
  } catch (err) {
    console.error('Command registration failed:', err);
  }

  await tick();
  setInterval(tick, REFRESH_EVERY);
  console.log(hasScrapeCreators() ? `ScrapeCreators enabled: TikTok/Instagram checked daily at ${CHECK_TIME} ${TIMEZONE}` : 'ScrapeCreators key not set: TikTok/Instagram posts must be dropped in the channel');
  daily(CHECK_TIME, TIMEZONE, () => pollAll(client));
});

async function tick() {
  for (const tracker of allTrackers()) {
    try {
      await checkOverdueReminder(client, tracker);
      await refresh(client, tracker.channelId);
    } catch (err) {
      console.error(`[tick] ${tracker.name}:`, err.message);
    }
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith('check:')) return handleCheckButton(interaction);
  if (!interaction.isChatInputCommand()) return;
  try {
    await handle(interaction, client);
  } catch (err) {
    console.error(`[command] /${interaction.commandName}:`, err);
    const msg = { content: 'Something went wrong running that command.', flags: MessageFlags.Ephemeral };
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
      else await interaction.reply(msg);
    } catch {
      /* ignore */
    }
  }
});

// The "Check now" button on the card. Managers and the creator can use it.
async function handleCheckButton(interaction) {
  const tracker = getTracker(interaction.channelId);
  if (!tracker) return interaction.reply({ content: 'This tracker no longer exists.', flags: MessageFlags.Ephemeral });
  const isManager = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
  const isCreator = tracker.creatorId && interaction.user.id === tracker.creatorId;
  if (!isManager && !isCreator) {
    return interaction.reply({ content: 'Only managers or the creator can trigger a check (it costs API credits).', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await interaction.editReply(await runCheck(client, tracker));
  } catch (err) {
    console.error('[check button]', err);
    await interaction.editReply('Check failed: ' + err.message).catch(() => {});
  }
}

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guildId) return;
  const tracker = getTracker(message.channelId);
  if (!tracker) return;

  let logged = 0;
  for (const url of extractUrls(message.content)) {
    const info = matchesCreator(url, tracker.links);
    if (!info) continue;
    if (addPost(tracker, { at: message.createdTimestamp, url, source: 'link', by: message.author.id, platform: info.platform, postId: postIdFromUrl(info) })) logged++;
  }
  if (logged) {
    tracker.overdueNotifiedFor = null;
    setTracker(message.channelId, tracker);
    try {
      await message.react('✅');
    } catch {
      /* no reaction permission, fine */
    }
    scheduleRepost(client, message.channelId, 1500);
  } else {
    scheduleRepost(client, message.channelId);
  }
});

// If someone deletes the card by hand, put it back on the next refresh.
client.on(Events.MessageDelete, (message) => {
  const tracker = getTracker(message.channelId);
  if (tracker && tracker.messageId === message.id && message.author?.id === client.user.id) {
    tracker.messageId = null;
    setTracker(message.channelId, tracker);
  }
});

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

client.login(process.env.DISCORD_TOKEN);
