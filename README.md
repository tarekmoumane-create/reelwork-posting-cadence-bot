# Posting Cadence Bot

A Discord bot that lives in each creator's channel and keeps a small status card at the bottom of the chat showing how they're doing against their posting schedule.

```
📊 Sarah — posting cadence
🔴 Overdue by 6h · last post 2 days ago
Was due 6 hours ago (Mon, Sep 7, 2026 9:00 AM)
▰▰▰▰▰▰▰▰▰▰▰▰ 112% of the window used

Cadence: every 2 days
Last 7 days: 2 / 3.5 expected ⚠️
Creator: @sarah
Tracking: 🎵 @sarah.ugc · 📸 @sarah.ugc

Recent: 2 days ago · 4 days ago · 6 days ago
```

Every time someone chats in the channel the bot deletes the old card and re-sends it, so it always sits at the bottom. Times use Discord's live timestamps, so "2 days ago" keeps ticking without a refresh.

## How posts get detected

| Source | How |
|---|---|
| **Automatic** (TikTok, Instagram, YouTube) | Once a day at 9 PM (set `CHECK_TIME` / `TIMEZONE` in `.env`) the bot asks each platform what the creator has posted. Between checks, hit the **🔍 Check now** button on the card or run `/tracker check`. TikTok and Instagram go through [ScrapeCreators](https://scrapecreators.com) (needs `SCRAPECREATORS_API_KEY`); YouTube uses its free public feed. New posts are announced in the channel ("🎵 New TikTok post detected: link") and the card updates. At setup, the last 30 days are imported so the card is accurate immediately. |
| Link dropped in the channel | Any post link from one of the creator's tracked platforms counts too. If the link includes a handle, it must match the tracked account, so sharing someone else's video doesn't count. The bot reacts ✅ when it logs one. Handy when someone wants the card green *now* without spending a credit. |
| `/posted` | Manual log. Optional `link` and `when` ("2h", "yesterday", "3 days ago"). Anyone in the channel can use it. |

Duplicates are handled: a link dropped in chat and the same post found later by the hourly check are recognised as one post by their platform post ID.

**Cost:** each check costs 1 ScrapeCreators credit per TikTok/Instagram profile. With 20 creators tracked on two platforms each, the daily check is 40 credits a day, plus whatever manual checks people trigger. Only managers and the creator can press the button. YouTube checks are free. Without a ScrapeCreators key, TikTok and Instagram fall back to link-in-channel only.

## Status colours

| | Meaning |
|---|---|
| 🟢 On track | Less than 75% of the posting window has passed since the last post |
| 🟡 Due soon | 75–100% of the window used |
| 🔴 Overdue | Past due. The creator gets pinged once (if you set `creator` on setup) |
| ⚪ No posts yet | Fresh tracker, nothing logged |

## Commands

Manager commands (need **Manage Channels**):

- `/tracker setup every:<cadence> links:<profile links> [creator:@user] [name:...] [remind:true/false] [announce:true/false]`
  Run this inside the creator's channel. Cadence examples: `daily`, `every 2 days`, `3x a week`, `twice a week`, `weekly`, `every 36 hours`. Links can be space or comma separated.
- `/tracker edit` — change any of the above.
- `/tracker remove` — stop tracking and delete the card.
- `/tracker refresh` — re-send the card at the bottom.
- `/tracker check` — same as the card's **Check now** button. Shows what it found and remaining ScrapeCreators credits.
- `/tracker undo` — remove the most recently logged post (e.g. a mis-detected link).
- `/tracker list` — one-line overview of every creator on the server, worst first.

Everyone:

- `/posted [link] [when]` — log a post.
- `/status` — see the card privately.

## Setup

### 1. Create the bot in Discord

1. Go to https://discord.com/developers/applications → **New Application**.
2. **Bot** tab → **Reset Token** → copy it (this is `DISCORD_TOKEN`).
3. Same tab, under **Privileged Gateway Intents**, turn on **Message Content Intent**. (Needed to see links in chat.)
4. **OAuth2** tab → **URL Generator**: tick `bot` and `applications.commands`. Under bot permissions tick **View Channels, Send Messages, Embed Links, Read Message History, Add Reactions**. Open the generated URL and add the bot to your server.
5. Optional: right-click your server → **Copy Server ID** (turn on Developer Mode in Discord settings if you don't see it). This is `GUILD_ID`; setting it makes commands show up instantly instead of after a few minutes. Several servers can be listed, separated by commas.

### 2. Run it

```bash
cp .env.example .env     # paste DISCORD_TOKEN (and GUILD_ID, SCRAPECREATORS_API_KEY) in
npm install
npm start
```

Then in a creator's channel:

```
/tracker setup every: 3x a week links: https://tiktok.com/@sarah.ugc https://instagram.com/sarah.ugc creator: @sarah
```

### 3. Keep it running

The bot needs to stay online to keep the cards updated. Options:

- **Your Mac / a spare machine:** `npm install -g pm2 && pm2 start src/index.js --name cadence-bot && pm2 save`
- **Railway / Render / Fly.io:** deploy this folder, set `DISCORD_TOKEN`, `GUILD_ID` and `SCRAPECREATORS_API_KEY` as environment variables, start command `npm start`. Make sure `data/` is on a persistent volume (or set `DATA_DIR` to one), otherwise trackers reset on redeploy.

Data lives in `data/trackers.json`. Back it up if you care about post history.

## Tests

```bash
npm test
```

Covers cadence parsing, link detection/matching and status maths. Doesn't need a Discord token.
