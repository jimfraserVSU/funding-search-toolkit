/**
 * grants-search — server-side proxy for the Grants.gov Search2 API.
 *
 * Why proxy at all, given Grants.gov sends Access-Control-Allow-Origin: *?
 *  1. It normalizes the response into one predictable shape for the client.
 *  2. It enforces sane bounds (rows, offset) so a bad query can't hammer the API.
 *  3. It adds a short CDN cache so a room full of faculty running the same
 *     search during a workshop hits Netlify's edge instead of Grants.gov.
 *  4. If Grants.gov ever tightens CORS, the site keeps working unchanged.
 *
 * Netlify Functions v2 (Web API Request/Response).
 */

const UPSTREAM = 'https://api.grants.gov/v1/api/search2';
const ALLOWED = [
  'keyword', 'oppNum', 'eligibilities', 'agencies', 'oppStatuses',
  'aln', 'cfda', 'fundingCategories', 'fundingInstruments',
  'sortBy', 'dateRange', 'rows', 'startRecordNum'
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

export default async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  let input;
  try {
    input = await req.json();
  } catch {
    return json({ error: 'Body must be JSON.' }, 400);
  }

  // Whitelist + clamp
  const payload = {};
  for (const k of ALLOWED) {
    if (input[k] === undefined || input[k] === null || input[k] === '') continue;
    payload[k] = input[k];
  }
  // Grants.gov honours `cfda` for Assistance Listing Numbers; `aln` is silently ignored.
  if (payload.aln && !payload.cfda) payload.cfda = payload.aln;
  delete payload.aln;
  payload.rows = Math.min(Math.max(parseInt(payload.rows, 10) || 25, 1), 100);
  payload.startRecordNum = Math.max(parseInt(payload.startRecordNum, 10) || 0, 0);
  if (!payload.oppStatuses) payload.oppStatuses = 'forecasted|posted';

  let upstream;
  try {
    const ctl = AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined;
    const r = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: ctl
    });
    if (!r.ok) return json({ error: `Grants.gov returned ${r.status}.`, hits: [], total: 0 }, 502);
    upstream = await r.json();
  } catch (e) {
    return json({ error: 'Could not reach Grants.gov right now. Try again shortly.', hits: [], total: 0 }, 504);
  }

  if (upstream.errorcode && upstream.errorcode !== 0) {
    return json({ error: upstream.msg || 'Grants.gov rejected the query.', hits: [], total: 0 }, 400);
  }

  const d = upstream.data || {};
  const hits = (d.oppHits || []).map((o) => ({
    id: o.id,
    number: o.number,
    title: o.title,
    agency: o.agency || o.agencyName || o.agencyCode,
    agencyCode: o.agencyCode,
    openDate: o.openDate || '',
    closeDate: o.closeDate || '',
    status: o.oppStatus,
    docType: o.docType,
    aln: o.cfdaList || o.alnist || [],
    url: `https://grants.gov/search-results-detail/${o.id}`
  }));

  const facet = (arr) =>
    (arr || []).map((f) => ({ label: f.label, value: f.value, count: f.count }));

  return json(
    {
      total: d.hitCount || 0,
      start: d.startRecord || 0,
      rows: payload.rows,
      hits,
      facets: {
        status: facet(d.oppStatusOptions),
        eligibility: facet(d.eligibilities),
        category: facet(d.fundingCategories),
        instrument: facet(d.fundingInstruments),
        agency: facet(d.agencies),
        dateRange: facet(d.dateRangeOptions)
      },
      suggestion: d.suggestion || '',
      fetched: new Date().toISOString()
    },
    200,
    { 'cache-control': 'public, max-age=0', 'netlify-cdn-cache-control': 'public, s-maxage=900, stale-while-revalidate=3600' }
  );
};
