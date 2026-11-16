// Runs a job once a day at a wall-clock time in a given IANA time zone.

function partsInZone(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const o = Object.fromEntries(f.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  return o;
}

/** UTC ms for the given wall-clock time in tz. */
function zonedToUtc(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi, 0);
  const p = partsInZone(new Date(guess), tz);
  const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return guess - (seen - guess);
}

export function nextRunAt(timeHHMM, tz, now = Date.now()) {
  const [h, mi] = timeHHMM.split(':').map(Number);
  const p = partsInZone(new Date(now), tz);
  let t = zonedToUtc(p.year, p.month, p.day, h, mi, tz);
  if (t <= now) {
    const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
    t = zonedToUtc(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), h, mi, tz);
  }
  return t;
}

export function validate(timeHHMM, tz) {
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(timeHHMM)) throw new Error(`CHECK_TIME "${timeHHMM}" must look like 21:00`);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new Error(`TIMEZONE "${tz}" is not a valid IANA time zone (e.g. America/New_York)`);
  }
}

/** Schedule `job` daily at timeHHMM in tz. Returns a function that cancels it. */
export function daily(timeHHMM, tz, job, log = console.log) {
  validate(timeHHMM, tz);
  let timer;
  const arm = () => {
    const at = nextRunAt(timeHHMM, tz);
    log(`[schedule] next check at ${new Date(at).toLocaleString('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })} ${tz}`);
    // setTimeout caps at ~24.8 days; a daily job is always well under that.
    timer = setTimeout(async () => {
      try {
        await job();
      } catch (err) {
        log(`[schedule] job failed: ${err.message}`);
      }
      arm();
    }, at - Date.now());
  };
  arm();
  return () => clearTimeout(timer);
}
