/**
 * foundations — server-side proxy for ProPublica's Nonprofit Explorer API (IRS Form 990 data).
 *
 * Why proxy: ProPublica's API sends NO Access-Control-Allow-Origin header, so the
 * browser cannot call it directly. Verified 2026-08-06 — the response carries no
 * access-control-* headers at all. A proxy is mandatory, not a nicety.
 *
 * What the upstream actually gives us (verified against live responses):
 *
 *   formtype 2  = 990-PF, private foundations. RICH.
 *       contrpdpbks     grants + contributions PAID (Part I line 25 col a)
 *       fairmrktvaleoy  fair market value of assets, end of year
 *       totassetsend    book value of assets, end of year
 *       operatingcd     'Y' if an OPERATING foundation (runs its own programs;
 *                       typically does NOT accept outside proposals)
 *       grntindivcd     makes grants to individuals
 *       pdf_url         the scanned return — Part XV lists every grantee by name
 *
 *   formtype 0  = 990, public charities & most community foundations. THIN.
 *       The extract exposes totrevenue / totfuncexpns / totassetsend but NOT
 *       grants paid — grntspdoth is absent from the 990 field set. We surface
 *       what exists and say plainly that grants paid is unavailable, rather than
 *       silently showing a zero that looks like "gives nothing".
 *
 *   formtype 1  = 990-EZ. Thinner still.
 *
 * Grantee-level detail (who actually received money) is NOT in this API for any
 * form type. It lives in the PDF. We link the PDF and label it accordingly.
 *
 * Netlify Functions v2 (Web API Request/Response).
 */

const BASE = 'https://projects.propublica.org/nonprofits/api/v2';
const UA = 'BuckyGreenloveFundingToolkit/1.0 (Virginia State University; faculty research tool)';

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'Content-Type',
      'access-control-allow-methods': 'GET, OPTIONS',
      ...extra
    }
  });

const CACHE = {
  'cache-control': 'public, max-age=0',
  'netlify-cdn-cache-control': 'public, s-maxage=86400, stale-while-revalidate=604800'
};

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function upstream(path) {
  const ctl = AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined;
  const r = await fetch(BASE + path, {
    headers: { accept: 'application/json', 'user-agent': UA },
    signal: ctl
  });
  if (!r.ok) {
    const err = new Error(`ProPublica returned ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

/* ---------- filing normalisation ---------------------------------------- */

const FORM = { 0: '990', 1: '990-EZ', 2: '990-PF' };

function normFiling(f) {
  const ft = f.formtype;
  const isPF = ft === 2;

  // Grants paid is only meaningful for 990-PF. For 990/990-EZ the extract
  // simply does not carry it — null means "not reported here", not zero.
  const grants = isPF ? num(f.contrpdpbks) : null;

  // Prefer fair market value for PF (that's the payout denominator the IRS uses);
  // fall back to book value for everyone else.
  const assets = isPF ? (num(f.fairmrktvaleoy) ?? num(f.totassetsend)) : num(f.totassetsend);

  return {
    year: f.tax_prd_yr ?? null,
    period: f.tax_prd ?? null,
    form: FORM[ft] || String(ft),
    isPF,
    grantsPaid: grants,
    assets,
    revenue: num(f.totrevenue),
    expenses: isPF ? (num(f.totexpnspbks) ?? num(f.totfuncexpns)) : num(f.totfuncexpns),
    netInvestmentIncome: isPF ? num(f.netinvstinc) : null,
    // payout: grants paid as a share of assets. The IRS minimum for a private
    // non-operating foundation is roughly 5% of investment assets. Well under
    // that, or well over, both tell you something.
    payoutPct: grants !== null && assets ? Math.round((grants / assets) * 1000) / 10 : null,
    operating: isPF ? (f.operatingcd === 'Y' ? true : f.operatingcd === 'N' ? false : null) : null,
    grantsToIndividuals: isPF ? (f.grntindivcd === 'Y' ? true : f.grntindivcd === 'N' ? false : null) : null,
    pdf: f.pdf_url || null
  };
}

/* ---------- handlers ----------------------------------------------------- */

async function doSearch(p) {
  const q = (p.get('q') || '').trim();
  const state = (p.get('state') || '').trim().toUpperCase();
  const ntee = (p.get('ntee') || '').trim();
  const page = Math.max(parseInt(p.get('page'), 10) || 0, 0);

  if (!q && !state && !ntee) {
    return json({ error: 'Give a name, a state, or a category to search on.', results: [], total: 0 }, 400);
  }

  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (page) qs.set('page', String(page));
  if (/^[A-Z]{2}$/.test(state)) qs.set('state[id]', state);
  if (/^\d{1,2}$/.test(ntee)) qs.set('ntee[id]', ntee);
  qs.set('c_code[id]', '3'); // 501(c)(3) only — the only class that matters here

  let d;
  try {
    d = await upstream('/search.json?' + qs.toString());
  } catch (e) {
    return json({ error: 'Could not reach ProPublica right now. Try again shortly.', results: [], total: 0 }, 504);
  }

  const results = (d.organizations || []).map((o) => ({
    ein: o.ein,
    einFormatted: o.strein || String(o.ein),
    name: o.name || o.sub_name || '(unnamed)',
    city: o.city || '',
    state: o.state || '',
    ntee: o.ntee_code || o.raw_ntee_code || ''
    // NOTE: the search endpoint returns have_filings / have_extracts / have_pdfs
    // as null for every row, always. Passing them through would render as
    // "no filings" for organisations that plainly have them, so they are dropped.
    // Whether a filing exists is only knowable from the org endpoint.
  }));

  return json(
    {
      total: d.total_results || 0,
      page: d.cur_page || 0,
      pages: d.num_pages || 0,
      perPage: d.per_page || results.length,
      results,
      source: 'ProPublica Nonprofit Explorer (IRS Form 990 extracts)',
      fetched: new Date().toISOString()
    },
    200,
    CACHE
  );
}

async function doOrg(p) {
  const raw = (p.get('ein') || '').replace(/\D/g, '');
  if (!/^\d{9}$/.test(raw)) return json({ error: 'EIN must be nine digits.' }, 400);

  let d;
  try {
    d = await upstream(`/organizations/${raw}.json`);
  } catch (e) {
    if (e.status === 404) return json({ error: 'No IRS record found for that EIN.' }, 404);
    return json({ error: 'Could not reach ProPublica right now. Try again shortly.' }, 504);
  }

  // ProPublica answers an unknown EIN with HTTP 200 and a placeholder record
  // named "Unknown Organization" rather than a 404, so check the payload itself.
  const o = d.organization;
  if (!o || !o.name || /^unknown organization$/i.test(o.name.trim())) {
    return json({ error: 'No IRS record found for that EIN.' }, 404);
  }

  const withData = (d.filings_with_data || []).map(normFiling);
  // Returns we know exist but have no machine-readable extract — still worth
  // linking, because the PDF holds the grantee list.
  const pdfOnly = (d.filings_without_data || [])
    .filter((f) => f.pdf_url)
    .map((f) => ({ year: f.tax_prd_yr, form: f.formtype_str || FORM[f.formtype] || '', pdf: f.pdf_url }));

  const pf = withData.filter((f) => f.isPF);
  const latest = withData[0] || null;
  const latestPF = pf[0] || null;

  // Median grants paid across available PF years — a steadier read than one year,
  // which can be distorted by a single large multi-year commitment.
  const paid = pf.map((f) => f.grantsPaid).filter((v) => v !== null && v > 0).sort((a, b) => a - b);
  const median = paid.length ? (paid.length % 2 ? paid[(paid.length - 1) / 2] : Math.round((paid[paid.length / 2 - 1] + paid[paid.length / 2]) / 2)) : null;

  // Trend: compare the mean of the newest three PF years to the oldest three.
  let trend = null;
  if (pf.length >= 4) {
    const vals = pf.map((f) => f.grantsPaid).filter((v) => v !== null);
    if (vals.length >= 4) {
      const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
      const recent = mean(vals.slice(0, 3));
      const older = mean(vals.slice(-3));
      if (older > 0) trend = Math.round(((recent - older) / older) * 100);
    }
  }

  return json(
    {
      ein: raw,
      einFormatted: o.ein ? String(o.ein).replace(/^(\d{2})(\d{7})$/, '$1-$2') : raw,
      name: o.name,
      city: o.city || '',
      state: o.state || '',
      address: o.address || '',
      zip: o.zipcode || '',
      ntee: o.ntee_code || '',
      subsection: o.subsection_code ?? o.subseccd ?? null,
      rulingDate: o.ruling_date || null,
      isPrivateFoundation: pf.length > 0,
      isOperating: latestPF ? latestPF.operating : null,
      grantsToIndividuals: latestPF ? latestPF.grantsToIndividuals : null,
      latestYear: latest ? latest.year : null,
      latestGrantsPaid: latestPF ? latestPF.grantsPaid : null,
      latestAssets: latest ? latest.assets : null,
      latestPayoutPct: latestPF ? latestPF.payoutPct : null,
      medianGrantsPaid: median,
      trendPct: trend,
      filings: withData,
      pdfOnly,
      // Said plainly so the page can render an honest caveat rather than implying
      // the absence of a number means the absence of giving.
      note: pf.length
        ? 'Figures come from the IRS 990-PF extract. Individual grant recipients are not in the data feed — they are listed in Part XV of the PDF returns linked below.'
        : 'This organisation files Form 990 rather than 990-PF. The IRS extract for Form 990 does not carry a grants-paid figure, so totals below cover revenue, expenses and assets only.',
      source: 'ProPublica Nonprofit Explorer (IRS Form 990 extracts)',
      sourceUrl: `https://projects.propublica.org/nonprofits/organizations/${raw}`,
      fetched: new Date().toISOString()
    },
    200,
    CACHE
  );
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'GET') return json({ error: 'Use GET.' }, 405);

  const p = new URL(req.url).searchParams;
  const mode = (p.get('mode') || 'search').toLowerCase();

  try {
    if (mode === 'org') return await doOrg(p);
    if (mode === 'search') return await doSearch(p);
    return json({ error: `Unknown mode "${mode}". Use search or org.` }, 400);
  } catch (e) {
    return json({ error: 'Unexpected error handling that request.' }, 500);
  }
};
