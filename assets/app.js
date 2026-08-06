/* Dr. Bucky Greenlove's Funding Search Toolkit — shared app code */
(function () {
  'use strict';

  var NAV = [
    ['index.html', 'Search'],
    ['calendar.html', 'Deadlines'],
    ['funders.html', 'Funders'],
    ['foundations.html', 'Foundation 990s'],
    ['awards.html', 'Award Intel'],
    ['budget.html', 'Budget'],
    ['proposal.html', 'Proposal Studio'],
    ['boilerplate.html', 'Boilerplate'],
    ['panel.html', 'Reviewer Panels'],
    ['playbook.html', 'Playbook'],
    ['vsu.html', 'VSU Roadmap']
  ];

  var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (here === '') here = 'index.html';

  window.TK = {
    nav: NAV,
    page: here,

    /* ---------- DOM ---------- */
    el: function (tag, attrs, kids) {
      var n = document.createElement(tag);
      for (var k in attrs || {}) {
        if (k === 'class') n.className = attrs[k];
        else if (k === 'html') n.innerHTML = attrs[k];
        else if (k === 'text') n.textContent = attrs[k];
        else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
      }
      (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
      return n;
    },
    esc: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },

    /* ---------- chrome ---------- */
    chrome: function () {
      var h = document.querySelector('header.site .navslot');
      if (h) {
        var ul = document.createElement('ul');
        NAV.forEach(function (n) {
          var li = document.createElement('li');
          var a = document.createElement('a');
          a.href = n[0]; a.textContent = n[1];
          if (n[0].toLowerCase() === here) a.setAttribute('aria-current', 'page');
          li.appendChild(a); ul.appendChild(li);
        });
        h.appendChild(ul);
      }
      var f = document.querySelector('footer.site .footslot');
      if (f) {
        f.innerHTML =
          '<div class="foot-grid">' +
          '<div><strong>Dr. Bucky Greenlove’s Funding Search Toolkit</strong>' +
          '<p style="margin-top:.5rem">A funding discovery and proposal development workbench for faculty, staff, and students at Virginia State University — and anyone else who finds it useful.</p></div>' +
          '<div><strong>Tools</strong><ul>' + NAV.map(function (n) {
            return '<li><a href="' + n[0] + '">' + n[1] + '</a></li>';
          }).join('') + '</ul></div>' +
          '<div><strong>Primary sources</strong><ul>' +
          '<li><a href="https://grants.gov/search-grants" rel="noopener">Grants.gov</a></li>' +
          '<li><a href="https://grants.nih.gov/funding/searchguide/index.html" rel="noopener">NIH Guide</a></li>' +
          '<li><a href="https://www.nsf.gov/funding/opportunities" rel="noopener">NSF Funding</a></li>' +
          '<li><a href="https://sam.gov/search/" rel="noopener">SAM.gov contracts</a></li>' +
          '<li><a href="https://www.vsu.edu/research/" rel="noopener">VSU Division of Research</a></li>' +
          '</ul></div></div>' +
          '<hr style="border-color:rgba(255,255,255,.13);margin:1.6rem 0 1rem">' +
          '<p style="margin:0;font-size:.82rem">Built by Dr. Bucky Greenlove (Dr. James Curtis Fraser), Virginia State University. Live federal results come directly from the Grants.gov Search2 API. Curated entries were link-checked on build; <strong>always confirm eligibility, deadlines, and budget rules against the funder’s own announcement before you write.</strong> Nothing here is an institutional commitment on behalf of VSU.</p>';
      }
      /* copy buttons */
      document.addEventListener('click', function (e) {
        var b = e.target.closest('.copy'); if (!b) return;
        var pre = b.closest('.prompt').querySelector('pre');
        navigator.clipboard.writeText(pre.innerText).then(function () {
          var t = b.textContent; b.textContent = 'Copied ✓'; b.classList.add('done');
          setTimeout(function () { b.textContent = t; b.classList.remove('done'); }, 1800);
        });
      });
    },

    /* ---------- money / dates ---------- */
    money: function (n) {
      if (!n) return null;
      /* Foundation endowments run to the tens of billions, so bare $M would
         print things like $62192.7M. Billions get their own branch. */
      if (n >= 1e9) return '$' + (n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1) + 'B';
      if (n >= 1e6) return '$' + (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + 'M';
      if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
      return '$' + n;
    },
    range: function (a, b) {
      var lo = TK.money(a), hi = TK.money(b);
      if (!lo && !hi) return 'Award size varies';
      if (lo && hi && lo !== hi) return lo + '–' + hi;
      return (hi || lo) + (b && !a ? ' max' : '');
    },
    /* Parse the month names out of a free-text deadline string -> next occurrence */
    nextDate: function (txt) {
      if (!txt) return null;
      var s = String(txt);
      if (/rolling|continuous|anytime|open\s*(all|year)|no deadline/i.test(s) && !/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(s)) return 'rolling';
      var iso = s.match(/(20\d\d)-(\d\d)-(\d\d)/);
      if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
      var M = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
      var re = /(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s*(\d{1,2})?(?:\s*,?\s*(20\d\d))?/gi;
      var now = new Date(), best = null, m;
      while ((m = re.exec(s))) {
        var mo = M[m[1].slice(0, 3).toLowerCase()];
        if (mo == null) continue;
        var day = m[2] ? +m[2] : 15;
        if (day < 1 || day > 31) day = 15;
        var yr = m[3] ? +m[3] : now.getFullYear();
        var d = new Date(yr, mo, day);
        if (!m[3] && d < now) d = new Date(yr + 1, mo, day);
        if (d >= now && (!best || d < best)) best = d;
      }
      return best;
    },
    /* Whole-day difference, ignoring time of day. Without this, a deadline
       later today reads as "-1 day" once the clock passes midnight-plus-one. */
    days: function (d) {
      if (!d || d === 'rolling') return null;
      var a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      var n = new Date();
      var b = new Date(n.getFullYear(), n.getMonth(), n.getDate());
      return Math.round((a - b) / 86400000);
    },
    /* Same, from a date string such as Grants.gov's MM/DD/YYYY. */
    daysFrom: function (s) {
      if (!s) return null;
      var d = new Date(s);
      if (isNaN(d)) return null;
      return TK.days(d);
    },
    fmtDate: function (d) {
      if (!d || d === 'rolling') return 'Rolling';
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },

    /* ---------- storage ---------- */
    stars: (function () {
      var mem = {};
      try { mem = JSON.parse(localStorage.getItem('bg_stars') || '{}'); } catch (e) { mem = {}; }
      /* A shortlist arriving in the URL is merged in, so a colleague can send
         you "here are the six worth looking at" as a plain link. */
      try {
        var shared = new URLSearchParams(location.search).get('stars');
        if (shared) shared.split(',').filter(Boolean).forEach(function (id) { mem[id] = 1; });
        if (shared) localStorage.setItem('bg_stars', JSON.stringify(mem));
      } catch (e) { }
      var save = function () { try { localStorage.setItem('bg_stars', JSON.stringify(mem)); } catch (e) { } };
      return {
        has: function (id) { return !!mem[id]; },
        toggle: function (id) {
          if (mem[id]) delete mem[id]; else mem[id] = 1;
          save();
          return !!mem[id];
        },
        clear: function () { mem = {}; save(); },
        all: function () { return Object.keys(mem); },
        count: function () { return Object.keys(mem).length; },
        shareUrl: function (page) {
          var ids = Object.keys(mem);
          if (!ids.length) return null;
          return location.origin + '/' + (page || 'index.html') + '?stars=' + ids.join(',');
        },
        feedUrl: function () {
          var ids = Object.keys(mem);
          if (!ids.length) return null;
          return location.origin + '/.netlify/functions/calendar?ids=' + ids.join(',');
        }
      };
    })(),

    /* ---------- profile ----------
       Five answers, stored in this browser only. Every page can narrow itself
       to the person reading it, which is the difference between a 208-row
       directory and "here are your twelve." */
    profile: (function () {
      var p = null;
      try { p = JSON.parse(localStorage.getItem('bg_profile') || 'null'); } catch (e) { p = null; }
      return {
        get: function () { return p; },
        set: function (v) { p = v; try { localStorage.setItem('bg_profile', JSON.stringify(v)); } catch (e) { } },
        clear: function () { p = null; try { localStorage.removeItem('bg_profile'); } catch (e) { } },
        /* Does a program plausibly fit this person? Deliberately permissive —
           a profile should narrow the pile, not hide things. */
        matches: function (prog) {
          if (!p) return true;
          if (p.fields && p.fields.length && !(prog.fields || []).some(function (f) { return p.fields.indexOf(f) >= 0; })) return false;
          if (p.stage && p.stage !== 'any') {
            var st = prog.career_stage || [];
            if (st.indexOf('any') < 0 && st.indexOf(p.stage) < 0) return false;
          }
          if (p.size === 'small' && prog.award_max && prog.award_max > 250000) return false;
          if (p.size === 'large' && prog.award_max && prog.award_max < 250000) return false;
          if (p.hbcuOnly && !prog.hbcu_msi) return false;
          if (p.evalOnly && !((prog.fields || []).indexOf('Program Evaluation') >= 0 || /evaluation/i.test(prog.blob || ''))) return false;
          return true;
        },
        /* Renders the profile strip into #profileBar if the page has one. */
        mount: function (onChange) {
          var host = document.getElementById('profileBar');
          if (!host) return;
          var FIELDS = ['STEM','Health & Medicine','Nursing','Education','Social Sciences','Humanities','Arts',
                        'Business','Engineering','Computing & Data','Agriculture & Food','Environment & Energy',
                        'Public Policy','Program Evaluation','International'];
          function draw() {
            var cur = p;
            if (!cur) {
              host.innerHTML = '<div class="note" style="margin:0 0 1.2rem"><strong>Set up your profile once</strong> and every page here narrows to work you are actually eligible for. It stays in this browser — nothing is sent anywhere. ' +
                '<button class="btn orange sm" id="pfOpen" style="margin-left:.5rem">Set up profile</button></div>';
            } else {
              host.innerHTML = '<div class="note ok" style="margin:0 0 1.2rem;display:flex;flex-wrap:wrap;gap:.6rem;align-items:center">' +
                '<span><strong>Filtered to you:</strong> ' +
                TK.esc((cur.fields || []).join(', ') || 'all disciplines') +
                (cur.stage && cur.stage !== 'any' ? ' · ' + TK.esc(cur.stage) : '') +
                (cur.size ? ' · ' + (cur.size === 'small' ? 'under $250K' : '$250K+') : '') +
                (cur.hbcuOnly ? ' · HBCU/MSI only' : '') +
                (cur.evalOnly ? ' · evaluation only' : '') + '</span>' +
                '<span style="flex:1"></span>' +
                '<button class="btn ghost sm" id="pfOpen">Edit</button>' +
                '<button class="btn ghost sm" id="pfOff">Turn off</button></div>';
            }
            var open = document.getElementById('pfOpen');
            if (open) open.onclick = function () { form(); };
            var off = document.getElementById('pfOff');
            if (off) off.onclick = function () { TK.profile.clear(); p = null; draw(); onChange && onChange(); };
          }
          function form() {
            var cur = p || {};
            host.innerHTML = '<div class="card" style="margin:0 0 1.2rem">' +
              '<h3 style="margin-top:0">Your profile</h3>' +
              '<p style="font-size:.9rem;color:var(--muted)">Five questions, stored only in this browser. You can change or remove it any time.</p>' +
              '<fieldset style="border:0;padding:0;margin:0 0 .9rem"><legend style="font-size:.7rem;font-weight:700;color:var(--rust);text-transform:uppercase;letter-spacing:.06em">Disciplines you work in</legend>' +
              '<div style="display:flex;flex-wrap:wrap;gap:.3rem .9rem;margin-top:.4rem">' +
              FIELDS.map(function (f) {
                return '<label class="opt" style="width:auto"><input type="checkbox" name="pf" value="' + TK.esc(f) + '"' +
                  ((cur.fields || []).indexOf(f) >= 0 ? ' checked' : '') + '><span>' + TK.esc(f) + '</span></label>';
              }).join('') + '</div></fieldset>' +
              '<div class="grid g3" style="gap:.8rem">' +
              '<div><label for="pfStage" style="font-size:.7rem;font-weight:700;color:var(--rust);text-transform:uppercase;letter-spacing:.06em">Career stage</label>' +
              '<select id="pfStage"><option value="any">Any</option><option value="graduate">Graduate student</option><option value="postdoc">Postdoc</option><option value="early-career">Early career</option><option value="mid-career">Mid career</option><option value="senior">Senior</option></select></div>' +
              '<div><label for="pfSize" style="font-size:.7rem;font-weight:700;color:var(--rust);text-transform:uppercase;letter-spacing:.06em">Award size you want</label>' +
              '<select id="pfSize"><option value="">Any size</option><option value="small">Seed and small — under $250K</option><option value="large">Substantial — $250K and up</option></select></div>' +
              '<div style="display:flex;flex-direction:column;justify-content:flex-end;gap:.3rem">' +
              '<label class="opt"><input type="checkbox" id="pfHbcu"' + (cur.hbcuOnly ? ' checked' : '') + '><span>HBCU / MSI programs only</span></label>' +
              '<label class="opt"><input type="checkbox" id="pfEval"' + (cur.evalOnly ? ' checked' : '') + '><span>Evaluation &amp; applied research only</span></label></div>' +
              '</div>' +
              '<div class="toolbar" style="margin:1rem 0 0"><button class="btn orange sm" id="pfSave">Save profile</button>' +
              '<button class="btn ghost sm" id="pfCancel">Cancel</button></div></div>';
            document.getElementById('pfStage').value = cur.stage || 'any';
            document.getElementById('pfSize').value = cur.size || '';
            document.getElementById('pfSave').onclick = function () {
              var v = {
                fields: [].map.call(host.querySelectorAll('input[name=pf]:checked'), function (i) { return i.value; }),
                stage: document.getElementById('pfStage').value,
                size: document.getElementById('pfSize').value,
                hbcuOnly: document.getElementById('pfHbcu').checked,
                evalOnly: document.getElementById('pfEval').checked
              };
              TK.profile.set(v); p = v; draw(); onChange && onChange();
            };
            document.getElementById('pfCancel').onclick = draw;
          }
          draw();
        }
      };
    })(),

    /* ---------- export ---------- */
    csv: function (rows, name) {
      var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"'; };
      var cols = Object.keys(rows[0] || { note: '' });
      var out = [cols.map(q).join(',')].concat(rows.map(function (r) {
        return cols.map(function (c) { return q(r[c]); }).join(',');
      })).join('\r\n');
      TK.download('﻿' + out, name, 'text/csv;charset=utf-8');
    },
    ics: function (events, name) {
      var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      var dt = function (d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); };
      var fold = function (s) { return s.replace(/[\\;,]/g, function (c) { return '\\' + c; }).replace(/\r?\n/g, '\\n'); };
      var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bucky Greenlove Funding Toolkit//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
      events.forEach(function (e, i) {
        var end = new Date(e.date.getTime() + 86400000);
        L.push('BEGIN:VEVENT', 'UID:bgft-' + i + '-' + dt(e.date) + '@buckygreenlove',
          'DTSTAMP:' + dt(new Date()) + 'T000000Z',
          'DTSTART;VALUE=DATE:' + dt(e.date), 'DTEND;VALUE=DATE:' + dt(end),
          'SUMMARY:' + fold(e.title), 'DESCRIPTION:' + fold(e.desc || ''),
          e.url ? 'URL:' + e.url : '', 'BEGIN:VALARM', 'TRIGGER:-P30D', 'ACTION:DISPLAY',
          'DESCRIPTION:' + fold('30 days to: ' + e.title), 'END:VALARM', 'END:VEVENT');
      });
      L.push('END:VCALENDAR');
      TK.download(L.filter(Boolean).join('\r\n'), name, 'text/calendar');
    },
    download: function (data, name, mime) {
      var b = new Blob([data], { type: mime });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    },

    /* ---------- data ---------- */
    load: function (path) {
      return fetch(path, { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('Could not load ' + path + ' (' + r.status + ')');
        return r.json();
      });
    },

    /* ---------- live federal search ---------- */
    liveSearch: function (params) {
      var body = JSON.stringify(params);
      return fetch('/.netlify/functions/grants-search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body
      }).then(function (r) {
        if (!r.ok) throw new Error('fn ' + r.status);
        return r.json();
      }).catch(function () {
        /* Fallback: Grants.gov sends Access-Control-Allow-Origin:* so a direct
           browser call works even if the serverless function is unavailable. */
        return fetch('https://api.grants.gov/v1/api/search2', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body
        }).then(function (r) { return r.json(); });
      });
    }
  };

  document.addEventListener('DOMContentLoaded', function () { TK.chrome(); });
})();
