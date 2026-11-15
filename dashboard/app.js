// Sakura Radar's dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, search plus category and chain
// filters, sortable columns, a per-protocol detail drawer with the model's
// own arithmetic and the protocol's farm plan, and a live-token view set
// apart from the ranking. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model, mirrored from lib/model.ts: the page recomputes a row from
  // the snapshot figures and checks the number board.json carries, so the
  // page's code and the board's data are visibly the same arithmetic.
  function categoryMultiple(category, m) {
    var c = (category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return m.lending_multiple;
    if (c.indexOf('dex') >= 0 || c.indexOf('derivat') >= 0 || c.indexOf('perpetual') >= 0) return m.exchange_multiple;
    if (c.indexOf('bridge') >= 0) return m.bridge_multiple;
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return m.staking_multiple;
    if (c.indexOf('rwa') >= 0) return m.rwa_multiple;
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return m.curator_multiple;
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return m.yield_multiple;
    return m.default_multiple;
  }
  function impliedOf(row, m) {
    var raw = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var pct = Math.min(m.momentum_cap, Math.max(m.momentum_floor, raw));
    var momentum = 1 + (pct / 100) * m.momentum_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var capped = Math.min(Math.max(age, 0), m.maturity_days);
    var maturity = m.maturity_floor + (Math.log1p(capped) / Math.log1p(m.maturity_days)) * m.maturity_range;
    var extra = Math.min(Math.max((row.chains || []).length, 1), m.breadth_max_chains) - 1;
    var breadth = 1 + extra * m.breadth_step;
    return Math.max(1, Math.round(row.tvl_usd * categoryMultiple(row.category, m) * momentum * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, first chain, TVL and age decide every action, cost and time.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasFor(chain) {
    var c = String(chain).toLowerCase();
    if (c.indexOf('ethereum') >= 0) return 14;
    if (c.indexOf('bitcoin') >= 0) return 6;
    if (c.indexOf('solana') >= 0) return 1;
    if (c.indexOf('binance') >= 0 || c.indexOf('bsc') >= 0) return 2;
    if (c.indexOf('polygon') >= 0) return 1;
    return 3;
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 300;
    if (p.tvl_usd >= 1e9) return 200;
    if (p.tvl_usd >= 2.5e8) return 120;
    if (p.tvl_usd >= 5e7) return 80;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 60;
    if (age < 180) return 75;
    if (age < 365) return 60;
    if (age < 730) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC as collateral in ' + name + ' on ' + chain + ', then borrow about 40% against it so both sides of the book record your wallet.';
    if (c.indexOf('dex') >= 0) return 'Swap about $' + Math.round(capital / 4) + ' through ' + name + "'s main pair on " + chain + ', then provide the remaining $' + (capital - Math.round(capital / 4)) + ' as two-sided liquidity in that same pool.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC from Ethereum to ' + chain + ' through ' + name + ', then put the bridged funds to work in one app on the far side instead of bridging straight back.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " worth of the chain's staking asset through " + name + ' on ' + chain + ' and keep the liquid receipt token in the same wallet.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivat') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ', open one small position of about $' + Math.round(capital / 5) + ' notional, and close it after a day so volume and an open-interest snapshot both count.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into the largest ' + name + ' vault on ' + chain + ' and keep the vault shares untouched in the farming wallet.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of ' + name + "'s yield-bearing asset on " + chain + ' with USDC and hold the minted asset in the farming wallet.';
    if (c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s main yield vault on " + chain + ' and leave auto-compounding switched on.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' through its main app and keep the position open.';
  }
  function secondActionFor(p, capital) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'Repay half the borrow after 7 days and borrow again, so ' + name + ' records two separate borrow cycles from your wallet.';
    if (c.indexOf('dex') >= 0) return 'Claim any fees ' + name + ' shows after the first week and add them back to the pool instead of withdrawing them.';
    if (c.indexOf('bridge') >= 0) return 'Make one return bridge of about $' + Math.round(capital / 4) + ' after at least 14 days, so ' + name + ' sees a round trip rather than a single hop.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Restake or re-delegate about $' + Math.round(capital / 3) + ' of the position once after 30 days, keeping the rest untouched.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivat') >= 0) return 'Trade one more small position in a second week and leave a resting limit order overnight once, so ' + name + ' records both active and passive flow from your wallet.';
    if (c.indexOf('rwa') >= 0) return 'Redeem about $' + Math.round(capital / 5) + ' of the minted asset after 30 days and mint it back a week later, so ' + name + ' records a full mint-redeem-mint cycle.';
    return 'Repeat the opening action once with about $' + Math.round(capital / 4) + ' more capital after 14 days, so ' + name + ' records a returning wallet, not a single visit.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    return [
      { text: 'Create a fresh wallet for ' + p.name + ' alone, back its seed phrase up offline, and fund it with the farming capital plus gas on ' + chain + '.', cost: 'about $' + gas + ' of gas to fund and make the first transaction', time: '10 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas * 2 + ' of gas for the two transactions', time: '20 minutes to set up' },
      { text: secondActionFor(p, capital), cost: 'about $' + gas + ' of gas, with the capital already in the position', time: '15 minutes, on day 7 to 14' },
      { text: 'Make one small qualifying action every week (a deposit top-up, a swap, a claim-and-restake or a governance vote) so no weekly snapshot misses the wallet.', cost: 'about $' + gas + ' of gas a week, roughly $' + gas * 4 + ' a month', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days: protocols this age usually weight duration and repeated snapshots, and an early exit wastes the gas already spent.', cost: 'the $' + capital + ' stays locked in the position for the whole window', time: hold + ' days' },
      { text: "Check the protocol's own points, rewards or governance page once a week and claim only through links that page publishes; never pay a third party to claim for you.", cost: 'nothing to check, and never pay a claim fee to anyone', time: '10 minutes a week' },
      { text: 'Keep a farm log with the wallet address, every transaction hash and the dates, then unwind in reverse order (withdraw, repay, unbridge) once a token or a snapshot date is announced.', cost: 'about $' + gas * 2 + ' of gas to unwind fully', time: '15 minutes to log, 20 minutes to exit' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'petal' }), el('span', { class: 'brand-name' }, 'Sakura ', el('b', { text: 'Radar' }))),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version })
      )
    );
  }

  function lede() {
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Pre-token protocols, ranked by what their token could be worth' }),
        el('p', null, 'Every protocol that records ', el('b', { text: 'no token' }), ' and holds at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL is on this board, plus ' + DATA.early_size + ' early finds below that floor. Implied value is this radar\u2019s own model of TVL, seven-day momentum, seasons without a token and chain breadth: an estimate to farm by, never a promise. Strongest first: ', el('b', { text: top ? top.name + ' at ' + fmtUsd(top.implied_value_usd) : 'n/a' }), '.')
      ),
      el('div', { class: 'kpis' },
        el('div', { class: 'kpi' }, el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('span', { text: 'watchlist covered' })),
        el('div', { class: 'kpi' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'pre-token rows ranked' })),
        el('div', { class: 'kpi' }, el('b', { text: String(DATA.early_size) }), el('span', { text: 'early finds below the floor' })),
        el('div', { class: 'kpi' }, el('b', { text: String(DATA.live_size) }), el('span', { text: 'live tokens set aside' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('span', { text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'Nothing on the radar matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var onWatch = r.tvl_usd >= DATA.floor_usd;
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'rank', text: '#' + r.rank }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' \u00b7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'chip' + (onWatch ? '' : ' early'), text: onWatch ? 'watchlist' : 'early find' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Select any row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Radar' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'rank', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' \u00b7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'chip', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'These protocols already trade: their market cap is a fact, not a model, so the radar sets them aside instead of ranking them.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How the radar prices a token that does not exist yet' }),
      el('p', { class: 'sub', text: 'One function scores every protocol from the snapshot\u2019s own figures. No name is special-cased and no row is hand-picked; open any row and the page recomputes its value in front of you.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl ', el('b', { text: '\u00d7 category ' + 'x' }), ' \u00d7 (1 + clamp(change_7d, ' + m.momentum_floor + ', ' + m.momentum_cap + ') / 100 \u00d7 ' + m.momentum_weight + ') \u00d7 (' + m.maturity_floor + ' + log-age share \u00d7 ' + m.maturity_range + ') \u00d7 (1 + ' + m.breadth_step + ' \u00d7 extra chains) )'
      ),
      el('p', { class: 'sub', text: 'Category multiples: lending ' + m.lending_multiple + ', exchanges and derivatives ' + m.exchange_multiple + ', real-world assets ' + m.rwa_multiple + ', curators ' + m.curator_multiple + ', staking ' + m.staking_multiple + ', default ' + m.default_multiple + ', yield ' + m.yield_multiple + ', bridges ' + m.bridge_multiple + '. Maturity uses the log of days since the protocol was first listed, capped at ' + m.maturity_days + ' days; an unlisted age counts as ' + m.unknown_age_days + ' days. Breadth adds one step per extra chain, up to ' + m.breadth_max_chains + ' chains.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank #' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' \u00b7 ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' \u00b7 records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value, step by step' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: '\u00d7 ' + row.category_multiple })),
        el('div', null, el('span', { text: '7d momentum (' + fmtPct(row.change_7d) + ')' }), el('b', { class: 'num', text: '\u00d7 ' + row.momentum_multiplier })),
        el('div', null, el('span', { text: 'Maturity, ' + fmtAge(row.age_days) + ' with no token' }), el('b', { class: 'num', text: '\u00d7 ' + row.maturity_multiplier })),
        el('div', null, el('span', { text: 'Chain breadth (' + (row.chains || []).length + ' chains)' }), el('b', { class: 'num', text: '\u00d7 ' + row.breadth_multiplier })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + '. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' An estimate of what a launch could be worth if the record held, not a price and not a prediction that a token comes.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan: 7 steps' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(el('p', { class: 'foot', text: 'Sakura Radar \u00b7 snapshot ' + DATA.as_of + ' \u00b7 implied values are the model\u2019s own claim, stated in the open so any reader can recompute them.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
