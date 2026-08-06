/**
 * awards — proxy + normalizer for NIH RePORTER and NSF Award Search.
 *
 * Both are free and key-less, but neither is usable directly from the browser:
 * RePORTER is POST-only with no permissive CORS, and NSF's endpoint is
 * inconsistent about it. Proxying also lets us return ONE shape for both, so
 * the page doesn't need two rendering paths.
 *
 * POST body:
 *   { mode: "org" | "program" | "peers",
 *     org?: string,          // institution name (mode=org)
 *     text?: string,         // free text (mode=program)
 *     activityCodes?: [..],  // NIH mechanism filter, e.g. ["R15","SC1"]
 *     nsfProgram?: string,   // NSF program name fragment
 *     years?: [2024,2025,2026],
 *     limit?: number }
 */

const REPORTER = 'https://api.reporter.nih.gov/v2/projects/search';
const NSF = 'https://api.nsf.gov/services/v1/awards.json';

/* HBCUs and MSIs with meaningful research activity — the comparison set that
   answers "is this actually winnable by an institution like ours?" */
const PEERS = [
  'HOWARD UNIVERSITY',
  'NORTH CAROLINA AGRICULTURAL & TECHNICAL STATE UNIVERSITY',
  'MORGAN STATE UNIVERSITY',
  'FLORIDA AGRICULTURAL AND MECHANICAL UNIVERSITY',
  'JACKSON STATE UNIVERSITY',
  'TENNESSEE STATE UNIVERSITY',
  'PRAIRIE VIEW A&M UNIVERSITY',
  'ALABAMA A&M UNIVERSITY',
  'DELAWARE STATE UNIVERSITY',
  'NORFOLK STATE UNIVERSITY',
  'HAMPTON UNIVERSITY',
  'CLARK ATLANTA UNIVERSITY',
  'TUSKEGEE UNIVERSITY',
  'TEXAS SOUTHERN UNIVERSITY',
  'VIRGINIA STATE UNIVERSITY'
];

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'Content-Type',
      'access-control-allow-methods': 'POST, OPTIONS',
      ...extra
    }
  });

const money = (n) => (typeof n === 'number' ? n : parseInt(n, 10) || 0);

async function nih(body) {
  const r = await fetch(REPORTER, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined
  });
  if (!r.ok) throw new Error(`RePORTER ${r.status}`);
  const d = await r.json();
  return {
    total: d?.meta?.total ?? (d.results || []).length,
    hits: (d.results || []).map((p) => ({
      source: 'NIH',
      title: p.project_title || '',
      org: p.organization?.org_name || '',
      state: p.organization?.org_state || '',
      amount: money(p.award_amount),
      year: p.fiscal_year,
      program: p.activity_code || '',
      admin: p.agency_ic_admin?.abbreviation || '',
      pi: p.contact_pi_name || '',
      num: p.project_num || '',
      url: p.appl_id ? `https://reporter.nih.gov/project-details/${p.appl_id}` : 'https://reporter.nih.gov/'
    }))
  };
}

async function nsf(params) {
  const qs = new URLSearchParams({
    printFields: 'id,title,awardeeName,awardeeStateCode,fundsObligatedAmt,date,fundProgramName,piFirstName,piLastName',
    rpp: '25',
    ...params
  });
  const r = await fetch(`${NSF}?${qs}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined
  });
  if (!r.ok) throw new Error(`NSF ${r.status}`);
  const d = await r.json();
  const awards = d?.response?.award || [];
  return {
    total: awards.length,
    hits: awards.map((a) => ({
      source: 'NSF',
      title: a.title || '',
      org: a.awardeeName || '',
      state: a.awardeeStateCode || '',
      amount: money(a.fundsObligatedAmt),
      year: (a.date || '').slice(-4),
      program: a.fundProgramName || '',
      admin: 'NSF',
      pi: [a.piFirstName, a.piLastName].filter(Boolean).join(' '),
      num: a.id || '',
      url: a.id ? `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${a.id}` : 'https://www.nsf.gov/awardsearch/'
    }))
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  let input;
  try { input = await req.json(); } catch { return json({ error: 'Body must be JSON.' }, 400); }

  const mode = input.mode || 'program';
  const years = Array.isArray(input.years) && input.years.length ? input.years : [2024, 2025, 2026];
  const limit = Math.min(Math.max(parseInt(input.limit, 10) || 25, 1), 50);

  const jobs = [];

  try {
    if (mode === 'org') {
      const org = (input.org || 'VIRGINIA STATE UNIVERSITY').toUpperCase();
      jobs.push(
        nih({ criteria: { org_names: [org], fiscal_years: years },
              include_fields: ['ProjectTitle','Organization','AwardAmount','FiscalYear','ActivityCode','AgencyIcAdmin','ContactPiName','ProjectNum','ApplId'],
              offset: 0, limit }).catch((e) => ({ total: 0, hits: [], error: String(e.message) })),
        nsf({ awardeeName: `"${org}"` }).catch((e) => ({ total: 0, hits: [], error: String(e.message) }))
      );
    } else if (mode === 'peers') {
      const orgs = PEERS;
      const crit = { org_names: orgs, fiscal_years: years };
      if (Array.isArray(input.activityCodes) && input.activityCodes.length) crit.activity_codes = input.activityCodes;
      if (input.text) crit.advanced_text_search = { operator: 'and', search_field: 'projecttitle,abstracttext,terms', search_text: input.text };
      jobs.push(
        nih({ criteria: crit,
              include_fields: ['ProjectTitle','Organization','AwardAmount','FiscalYear','ActivityCode','AgencyIcAdmin','ContactPiName','ProjectNum','ApplId'],
              offset: 0, limit }).catch((e) => ({ total: 0, hits: [], error: String(e.message) }))
      );
      const nsfP = {};
      if (input.text) nsfP.keyword = `"${input.text}"`;
      if (input.nsfProgram) nsfP.fundProgramName = `"${input.nsfProgram}"`;
      jobs.push(nsf(nsfP).catch((e) => ({ total: 0, hits: [], error: String(e.message) })));
    } else {
      const crit = { fiscal_years: years };
      if (Array.isArray(input.activityCodes) && input.activityCodes.length) crit.activity_codes = input.activityCodes;
      if (input.text) crit.advanced_text_search = { operator: 'and', search_field: 'projecttitle,abstracttext,terms', search_text: input.text };
      jobs.push(
        nih({ criteria: crit,
              include_fields: ['ProjectTitle','Organization','AwardAmount','FiscalYear','ActivityCode','AgencyIcAdmin','ContactPiName','ProjectNum','ApplId'],
              offset: 0, limit }).catch((e) => ({ total: 0, hits: [], error: String(e.message) }))
      );
      const nsfP = {};
      if (input.text) nsfP.keyword = `"${input.text}"`;
      if (input.nsfProgram) nsfP.fundProgramName = `"${input.nsfProgram}"`;
      jobs.push(nsf(nsfP).catch((e) => ({ total: 0, hits: [], error: String(e.message) })));
    }

    const results = await Promise.all(jobs);
    const hits = results.flatMap((r) => r.hits || []);
    hits.sort((a, b) => (b.year - a.year) || (b.amount - a.amount));

    /* Roll-ups the page uses for the summary strip */
    const byOrg = {}, byProgram = {};
    let total = 0;
    hits.forEach((h) => {
      total += h.amount;
      byOrg[h.org] = (byOrg[h.org] || 0) + h.amount;
      if (h.program) byProgram[h.program] = (byProgram[h.program] || 0) + 1;
    });
    const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, value: v }));

    return json({
      mode,
      count: hits.length,
      nihTotal: results[0]?.total ?? 0,
      totalDollars: total,
      medianAward: hits.length ? hits.map(h => h.amount).filter(Boolean).sort((a, b) => a - b)[Math.floor(hits.filter(h => h.amount).length / 2)] || 0 : 0,
      topOrgs: top(byOrg, 8),
      topPrograms: top(byProgram, 8),
      hits,
      errors: results.map((r) => r.error).filter(Boolean),
      fetched: new Date().toISOString()
    }, 200, { 'netlify-cdn-cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400' });
  } catch (e) {
    return json({ error: 'Could not reach the award databases right now.', detail: String(e.message), hits: [], count: 0 }, 502);
  }
};
