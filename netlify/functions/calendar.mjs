/**
 * calendar — a live, subscribable .ics feed of funding deadlines.
 *
 * Subscribe once in Outlook / Google / Apple Calendar and the deadlines stay
 * current, instead of being a snapshot from whenever someone hit "download".
 *
 * Query params (all optional):
 *   fields=Education,STEM     restrict to disciplines
 *   hbcu=1                    only HBCU/MSI-eligible programs
 *   eval=1                    only program-evaluation / applied research
 *   stage=early-career        restrict by career stage
 *   days=365                  how far ahead to publish (default 365)
 *   ids=a,b,c                 only these program ids (a starred shortlist)
 */

const MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };

/* Mirrors TK.nextDate() in assets/app.js — keep the two in step. */
function nextDate(txt) {
  if (!txt) return null;
  const s = String(txt);
  if (/rolling|continuous|anytime|open\s*(all|year)|no deadline/i.test(s) &&
      !/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(s)) return 'rolling';
  const iso = s.match(/(20\d\d)-(\d\d)-(\d\d)/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  const re = /(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s*(\d{1,2})?(?:\s*,?\s*(20\d\d))?/gi;
  const now = new Date();
  let best = null, m;
  while ((m = re.exec(s))) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo == null) continue;
    let day = m[2] ? +m[2] : 15;
    if (day < 1 || day > 31) day = 15;
    const yr = m[3] ? +m[3] : now.getFullYear();
    let d = new Date(yr, mo, day);
    if (!m[3] && d < now) d = new Date(yr + 1, mo, day);
    if (d >= now && (!best || d < best)) best = d;
  }
  return best;
}

const pad = (n) => (n < 10 ? '0' + n : '' + n);
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const esc = (s) => String(s || '').replace(/[\\;,]/g, (c) => '\\' + c).replace(/\r?\n/g, '\\n');

/* iCalendar lines must not exceed 75 octets; fold with CRLF + single space. */
function fold(line) {
  if (line.length <= 74) return line;
  const out = [line.slice(0, 74)];
  let rest = line.slice(74);
  while (rest.length > 73) { out.push(' ' + rest.slice(0, 73)); rest = rest.slice(73); }
  if (rest) out.push(' ' + rest);
  return out.join('\r\n');
}

export default async (req) => {
  const url = new URL(req.url);
  const q = url.searchParams;

  let programs;
  try {
    const r = await fetch(new URL('/data/programs.json', url.origin), {
      signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined
    });
    if (!r.ok) throw new Error(String(r.status));
    programs = await r.json();
  } catch {
    return new Response('Could not load the program directory.', { status: 502 });
  }

  const fields = (q.get('fields') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const stages = (q.get('stage') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ids = (q.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const onlyHbcu = q.get('hbcu') === '1';
  const onlyEval = q.get('eval') === '1';
  const days = Math.min(Math.max(parseInt(q.get('days'), 10) || 365, 30), 730);
  const horizon = new Date(); horizon.setDate(horizon.getDate() + days);

  const events = [];
  for (const p of programs) {
    if (ids.length && !ids.includes(p.id)) continue;
    if (!ids.length) {
      if (fields.length && !(p.fields || []).some((f) => fields.includes(f))) continue;
      if (stages.length && !(p.career_stage || []).some((s) => stages.includes(s))) continue;
      if (onlyHbcu && !p.hbcu_msi) continue;
      if (onlyEval && !((p.fields || []).includes('Program Evaluation') || /evaluation/i.test(p.blob || ''))) continue;
    }
    const d = nextDate(p.deadline);
    if (!d || d === 'rolling') continue;
    if (d > horizon) continue;
    events.push({ d, p });
  }
  events.sort((a, b) => a.d - b.d);

  const now = new Date();
  const L = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//Dr. Bucky Greenlove Funding Search Toolkit//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Funding Deadlines — Bucky Greenlove Toolkit',
    'X-WR-CALDESC:Deadlines estimated from each program\'s published cycle. Always confirm against the funder page.',
    'REFRESH-INTERVAL;VALUE=DURATION:P1D',
    'X-PUBLISHED-TTL:P1D'
  ];

  events.forEach(({ d, p }, i) => {
    const end = new Date(d.getTime() + 86400000);
    const desc = [
      p.sponsor,
      p.award_min || p.award_max ? `Award: ${p.award_min ? '$' + p.award_min.toLocaleString() : '?'}–${p.award_max ? '$' + p.award_max.toLocaleString() : '?'}` : '',
      p.deadline ? `Published cycle: ${p.deadline}` : '',
      '',
      'This date is ESTIMATED from the program cycle. Confirm against the funder before planning around it:',
      p.url
    ].filter(Boolean).join('\n');

    L.push(
      'BEGIN:VEVENT',
      `UID:bgft-${p.id}-${stamp(d)}@bucky-greenlove-funding-toolkit`,
      `DTSTAMP:${stamp(now)}T000000Z`,
      `DTSTART;VALUE=DATE:${stamp(d)}`,
      `DTEND;VALUE=DATE:${stamp(end)}`,
      fold(`SUMMARY:Grant deadline: ${esc(p.name)}`),
      fold(`DESCRIPTION:${esc(desc)}`),
      fold(`URL:${p.url}`),
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'TRIGGER:-P30D', 'ACTION:DISPLAY',
      fold(`DESCRIPTION:${esc('30 days to: ' + p.name)}`), 'END:VALARM',
      'BEGIN:VALARM', 'TRIGGER:-P7D', 'ACTION:DISPLAY',
      fold(`DESCRIPTION:${esc('One week to: ' + p.name)}`), 'END:VALARM',
      'END:VEVENT'
    );
  });

  L.push('END:VCALENDAR');

  return new Response(L.join('\r\n'), {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="funding-deadlines.ics"',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=0, must-revalidate',
      'netlify-cdn-cache-control': 'public, s-maxage=21600, stale-while-revalidate=86400'
    }
  });
};
