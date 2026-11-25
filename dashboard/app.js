// Token Radar's static dashboard.
//
// Reads window.RADAR, written beside dashboard/ by main.ts as out/data.js, and renders the ranked
// pre-token board, a sortable and filterable table, a live-token view that is kept strictly apart,
// and a detail drawer for every protocol. No fetch, no framework, no external asset: the page works
// from file:// and every byte it shows arrives in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var root = document.getElementById('app');
  if (!root) return;
  if (!DATA) {
    root.setAttribute('aria-busy', 'false');
    root.textContent = 'No data found. Run main.ts so that out/data.js sits beside dashboard/, then open out/dashboard/index.html.';
    return;
  }

  // ---------------------------------------------------------------- state

  var state = {
    q: '',
    category: 'all',
    chain: 'all',
    tab: 'pre-token',
    sort: 'implied',
    dir: -1,
    watchOnly: false,
    selected: null
  };

  var searchInput, categorySelect, chainSelect, watchToggle, tabButtons, countEl, boardMount;

  // ---------------------------------------------------------------- formatters

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageText(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function growthClass(n) {
    if (n === null || n === undefined) return '';
    return n > 0 ? 'pos' : n < 0 ? 'neg' : 'flat';
  }
  function categoryOf(row) {
    return row.category || 'Uncategorized';
  }
  function chainSummary(chains) {
    if (!chains || chains.length === 0) return 'unnamed chain';
    if (chains.length <= 2) return chains.join(', ');
    return chains.slice(0, 2).join(', ') + ' +' + (chains.length - 2);
  }

  // ---------------------------------------------------------------- DOM helper

  function appendChild(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(document.createTextNode(String(child)));
    } else {
      node.appendChild(child);
    }
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key.slice(0, 2) === 'on' && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, value);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (Array.isArray(child)) child.forEach(function (c) { appendChild(node, c); });
      else appendChild(node, child);
    }
    return node;
  }

  // ---------------------------------------------------------------- derived lists

  var CATEGORIES = (function () {
    var seen = {};
    DATA.rows.concat(DATA.live).forEach(function (r) { seen[categoryOf(r)] = true; });
    return Object.keys(seen).sort();
  })();
  var CHAINS = (function () {
    var counts = {};
    DATA.rows.forEach(function (r) {
      (r.chains || []).forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
    });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
  })();

  // ---------------------------------------------------------------- hash state

  function readHash() {
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    var params = new URLSearchParams(raw);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('cat')) state.category = params.get('cat');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab') === 'live' || params.get('tab') === 'pre-token') state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('dir') === '1' || params.get('dir') === '-1') state.dir = Number(params.get('dir'));
    if (params.get('watch') === '1') state.watchOnly = true;
    if (params.get('p')) state.selected = params.get('p');
  }
  function normalizeState() {
    if (state.tab !== 'live') state.tab = 'pre-token';
    if (CATEGORIES.indexOf(state.category) < 0) state.category = 'all';
    if (state.chain !== 'all' && CHAINS.indexOf(state.chain) < 0) state.chain = 'all';
    if (['implied', 'name', 'category', 'chains', 'tvl', 'growth', 'age', 'mcap', 'rank'].indexOf(state.sort) < 0) {
      state.sort = state.tab === 'live' ? 'mcap' : 'implied';
    }
    if (state.tab === 'pre-token' && state.sort === 'mcap') state.sort = 'implied';
    if (state.tab === 'live' && state.sort === 'implied') state.sort = 'mcap';
    if (state.dir !== 1 && state.dir !== -1) state.dir = -1;
  }
  function syncHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('cat', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.dir !== -1) params.set('dir', String(state.dir));
    if (state.watchOnly) params.set('watch', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    try {
      window.history.replaceState(null, '', next ? '#' + next : '#');
    } catch (e) {
      window.location.hash = next;
    }
  }

  // ---------------------------------------------------------------- filtering and sorting

  function filterList(list, live) {
    var q = state.q.trim().toLowerCase();
    return list.filter(function (r) {
      if (!live && state.watchOnly && !r.on_watchlist) return false;
      if (state.category !== 'all' && categoryOf(r) !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function valueFor(row, key, live) {
    if (key === 'name') return row.name.toLowerCase();
    if (key === 'category') return categoryOf(row).toLowerCase();
    if (key === 'chains') return (row.chains || []).length;
    if (key === 'tvl') return row.tvl_usd;
    if (key === 'growth') return row.change_7d;
    if (key === 'age') return row.age_days;
    if (key === 'mcap') return row.mcap_usd;
    if (key === 'implied') return live ? (row.mcap_usd === null || row.mcap_usd === undefined ? row.tvl_usd : row.mcap_usd) : row.implied_value_usd;
    return row.implied_value_usd;
  }
  function bySlug(a, b) {
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  }
  function sortRows(list, live) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av = valueFor(a, key, live);
      var bv = valueFor(b, key, live);
      var an = av === null || av === undefined;
      var bn = bv === null || bv === undefined;
      if (an && bn) return bySlug(a, b);
      if (an) return 1;
      if (bn) return -1;
      if (av < bv) return -1 * state.dir;
      if (av > bv) return 1 * state.dir;
      return bySlug(a, b);
    });
  }

  // ---------------------------------------------------------------- chrome

  function masthead() {
    return el('header', { class: 'masthead' },
      el('div', { class: 'brand' },
        el('span', { class: 'radar-mark', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-text' },
          el('span', { class: 'wordmark', text: 'Token Radar' }),
          el('span', { class: 'brand-sub', text: 'pre-token intelligence' })
        )
      ),
      el('div', { class: 'mast-meta' },
        el('span', { class: 'pill', text: 'snapshot ' + DATA.as_of }),
        el('span', { class: 'pill', text: DATA.model_version }),
        el('span', { class: 'pill pill-live', text: 'offline · no network' })
      )
    );
  }

  function stat(value, label, sub) {
    return el('div', { class: 'stat' },
      el('span', { class: 'stat-label', text: label }),
      el('strong', { class: 'stat-value', text: String(value) }),
      el('span', { class: 'stat-sub', text: sub })
    );
  }
  function hero() {
    var top = DATA.rows[0];
    return el('section', { class: 'hero' },
      el('p', { class: 'eyebrow', text: 'DefiLlama protocol index · ' + DATA.watchlist_size + '-slug watchlist' }),
      el('h1', null, 'The protocols that ', el('em', null, 'have not'), ' launched a token yet.'),
      el('p', {
        class: 'lede',
        text: 'Token Radar scores every pre-token protocol with one transparent function of TVL, seven-day growth, age without a token, chain reach, category and funding. The watchlist is the floor; the board ranks ' + DATA.board_size + ' protocols, including ' + DATA.early_size + ' the watchlist left out.'
      }),
      el('div', { class: 'stats' },
        stat(DATA.protocols_scanned, 'Protocols scanned', 'DefiLlama index'),
        stat(DATA.board_size, 'Pre-token ranked', DATA.pre_token_total + ' protocols with no token'),
        stat(money(DATA.top_implied), 'Top implied value', top ? top.name : 'n/a'),
        stat(DATA.watchlist_covered + '/' + DATA.watchlist_size, 'Watchlist covered', 'floor ' + money(DATA.floor_usd))
      )
    );
  }

  function switchTab(tab) {
    state.tab = tab;
    state.category = 'all';
    state.chain = 'all';
    state.watchOnly = false;
    state.sort = tab === 'live' ? 'mcap' : 'implied';
    state.dir = -1;
    categorySelect.value = 'all';
    chainSelect.value = 'all';
    watchToggle.checked = false;
    tabButtons.pre.setAttribute('aria-pressed', tab === 'pre-token' ? 'true' : 'false');
    tabButtons.live.setAttribute('aria-pressed', tab === 'live' ? 'true' : 'false');
    syncHash();
    renderBoard();
  }
  function resetFilters() {
    state.q = '';
    state.category = 'all';
    state.chain = 'all';
    state.watchOnly = false;
    searchInput.value = '';
    categorySelect.value = 'all';
    chainSelect.value = 'all';
    watchToggle.checked = false;
    syncHash();
    renderBoard();
  }

  function toolbar() {
    searchInput = el('input', {
      type: 'search', id: 'search', class: 'control',
      placeholder: 'Search name, slug, category or chain',
      'aria-label': 'Search protocols', value: state.q
    });
    searchInput.addEventListener('input', function () {
      state.q = searchInput.value;
      syncHash();
      renderBoard();
    });

    categorySelect = el('select', { id: 'category', class: 'control', 'aria-label': 'Filter by category' });
    categorySelect.appendChild(el('option', { value: 'all', text: 'All categories' }));
    CATEGORIES.forEach(function (c) { categorySelect.appendChild(el('option', { value: c, text: c })); });
    categorySelect.value = state.category;
    categorySelect.addEventListener('change', function () {
      state.category = categorySelect.value;
      syncHash();
      renderBoard();
    });

    chainSelect = el('select', { id: 'chain', class: 'control', 'aria-label': 'Filter by chain' });
    chainSelect.appendChild(el('option', { value: 'all', text: 'All chains' }));
    CHAINS.forEach(function (c) { chainSelect.appendChild(el('option', { value: c, text: c })); });
    chainSelect.value = state.chain;
    chainSelect.addEventListener('change', function () {
      state.chain = chainSelect.value;
      syncHash();
      renderBoard();
    });

    watchToggle = el('input', { type: 'checkbox', id: 'watch' });
    watchToggle.checked = state.watchOnly;
    watchToggle.addEventListener('change', function () {
      state.watchOnly = watchToggle.checked;
      syncHash();
      renderBoard();
    });

    var preBtn = el('button', {
      type: 'button', class: 'seg-btn', text: 'Pre-token',
      'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false'
    });
    var liveBtn = el('button', {
      type: 'button', class: 'seg-btn', text: 'Live token',
      'aria-pressed': state.tab === 'live' ? 'true' : 'false'
    });
    preBtn.addEventListener('click', function () { switchTab('pre-token'); });
    liveBtn.addEventListener('click', function () { switchTab('live'); });
    tabButtons = { pre: preBtn, live: liveBtn };

    countEl = el('span', { class: 'result-count', 'aria-live': 'polite' });

    return el('section', { class: 'toolbar', 'aria-label': 'Board controls' },
      el('div', { class: 'field field-search' },
        el('label', { for: 'search', text: 'Search' }),
        searchInput
      ),
      el('div', { class: 'field' },
        el('label', { for: 'category', text: 'Category' }),
        categorySelect
      ),
      el('div', { class: 'field' },
        el('label', { for: 'chain', text: 'Chain' }),
        chainSelect
      ),
      el('div', { class: 'field' },
        el('span', { class: 'field-label', text: 'Scope' }),
        el('label', { class: 'check', for: 'watch' }, watchToggle, el('span', { text: 'Watchlist only' }))
      ),
      el('div', { class: 'field' },
        el('span', { class: 'field-label', text: 'Token status' }),
        el('div', { class: 'segmented' }, preBtn, liveBtn)
      ),
      el('div', { class: 'toolbar-tail' },
        countEl,
        el('button', { type: 'button', class: 'reset', text: 'Reset', onclick: resetFilters })
      )
    );
  }

  // ---------------------------------------------------------------- table

  function panelHead(title, sub) {
    return el('div', { class: 'panel-head' },
      el('h2', { text: title }),
      el('p', { class: 'sub', text: sub })
    );
  }
  function sortTh(key, label, cls) {
    var active = state.sort === key;
    var th = el('th', {
      scope: 'col', class: cls,
      'aria-sort': active ? (state.dir === 1 ? 'ascending' : 'descending') : 'none'
    });
    var button = el('button', { type: 'button', class: 'sort-btn' }, label);
    if (active) button.appendChild(el('span', { class: 'sort-arrow', 'aria-hidden': 'true', text: state.dir === 1 ? '↑' : '↓' }));
    button.addEventListener('click', function () {
      if (state.sort === key) {
        state.dir = -state.dir;
      } else {
        state.sort = key;
        state.dir = key === 'name' || key === 'category' ? 1 : -1;
      }
      syncHash();
      renderBoard();
    });
    th.appendChild(button);
    return th;
  }
  function interactiveRow(row) {
    var tr = el('tr', {
      tabindex: '0',
      'data-slug': row.slug,
      'data-selected': state.selected === row.slug ? 'true' : 'false',
      'aria-label': 'Open details for ' + row.name
    });
    tr.addEventListener('click', function () { selectRow(row.slug); });
    tr.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectRow(row.slug);
      }
    });
    return tr;
  }

  function preTokenTable(list) {
    var tbody = el('tbody');
    var top = DATA.top_implied || 1;
    list.forEach(function (row) {
      var tr = interactiveRow(row);
      tr.appendChild(el('td', { class: 'col-rank rank', text: String(row.rank) }));
      tr.appendChild(el('td', { class: 'col-proto' },
        el('div', { class: 'proto' },
          el('div', { class: 'proto-name' },
            el('b', { text: row.name }),
            row.on_watchlist ? el('span', { class: 'watch-tag', title: 'On the house watchlist', text: 'watchlist' }) : null
          ),
          el('span', { class: 'proto-slug', text: row.slug })
        )
      ));
      tr.appendChild(el('td', { class: 'col-cat' }, el('span', { class: 'tag', text: categoryOf(row) })));
      tr.appendChild(el('td', { class: 'col-chains' }, el('span', { class: 'chains', text: chainSummary(row.chains) })));
      tr.appendChild(el('td', { class: 'col-implied' },
        el('div', { class: 'implied-cell' },
          el('div', { class: 'bar', 'aria-hidden': 'true' },
            el('i', { style: 'width:' + Math.min(100, Math.max(4, Math.round((row.implied_value_usd / top) * 100))) + '%' })
          ),
          el('strong', { class: 'money', text: money(row.implied_value_usd) })
        )
      ));
      tr.appendChild(el('td', { class: 'col-tvl num', text: money(row.tvl_usd) }));
      tr.appendChild(el('td', { class: 'col-growth num ' + growthClass(row.change_7d), text: pct(row.change_7d) }));
      tr.appendChild(el('td', { class: 'col-age', text: ageText(row.age_days) }));
      tbody.appendChild(tr);
    });

    return el('div', { class: 'panel-inner' },
      panelHead('Pre-token board', 'Ranked by implied value. Select any row for the value breakdown, the "why this value" sentence and a four-step farm plan.'),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sr-only', text: 'Pre-token protocols ranked by implied value' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', class: 'col-rank', text: '#' }),
            sortTh('name', 'Protocol', 'col-proto'),
            sortTh('category', 'Category', 'col-cat'),
            sortTh('chains', 'Chains', 'col-chains'),
            sortTh('implied', 'Implied value', 'col-implied'),
            sortTh('tvl', 'TVL', 'col-tvl'),
            sortTh('growth', '7d', 'col-growth'),
            sortTh('age', 'Age without token', 'col-age')
          )),
          tbody
        )
      )
    );
  }

  function liveTable(list) {
    var tbody = el('tbody');
    list.forEach(function (row) {
      var tr = interactiveRow(row);
      tr.appendChild(el('td', { class: 'col-proto' },
        el('div', { class: 'proto' },
          el('div', { class: 'proto-name' },
            el('b', { text: row.name }),
            row.symbol ? el('span', { class: 'watch-tag', text: row.symbol }) : null
          ),
          el('span', { class: 'proto-slug', text: row.slug })
        )
      ));
      tr.appendChild(el('td', { class: 'col-cat' }, el('span', { class: 'tag', text: categoryOf(row) })));
      tr.appendChild(el('td', { class: 'col-chains' }, el('span', { class: 'chains', text: chainSummary(row.chains) })));
      tr.appendChild(el('td', { class: 'col-tvl num', text: money(row.tvl_usd) }));
      tr.appendChild(el('td', { class: 'col-growth num ' + growthClass(row.change_7d), text: pct(row.change_7d) }));
      tr.appendChild(el('td', { class: 'col-mcap num', text: money(row.mcap_usd) }));
      tr.appendChild(el('td', null, el('span', { class: 'status-live', text: 'trades now' })));
      tbody.appendChild(tr);
    });

    return el('div', { class: 'panel-inner' },
      panelHead('Live token market', 'These protocols already trade, so their market cap is shown as a fact, not a model. They are kept out of the pre-token ranking.'),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sr-only', text: 'Live-token protocols by market cap' }),
          el('thead', null, el('tr', null,
            sortTh('name', 'Protocol', 'col-proto'),
            sortTh('category', 'Category', 'col-cat'),
            sortTh('chains', 'Chains', 'col-chains'),
            sortTh('tvl', 'TVL', 'col-tvl'),
            sortTh('growth', '7d', 'col-growth'),
            sortTh('mcap', 'Market cap', 'col-mcap'),
            el('th', { scope: 'col' }, el('span', { class: 'sr-only', text: 'Status' }))
          )),
          tbody
        )
      )
    );
  }

  function emptyState() {
    return el('div', { class: 'empty' },
      el('h2', { text: 'No protocol matches those filters' }),
      el('p', { text: 'Clear the search, category or chain filter to bring the board back.' }),
      el('button', { type: 'button', class: 'reset reset-lg', text: 'Clear filters', onclick: resetFilters })
    );
  }

  function renderBoard() {
    boardMount.textContent = '';
    var isLive = state.tab === 'live';
    var source = isLive ? DATA.live : DATA.rows;
    var list = sortRows(filterList(source, isLive), isLive);
    updateCount(list.length, isLive);
    if (list.length === 0) {
      boardMount.appendChild(emptyState());
      return;
    }
    boardMount.appendChild(isLive ? liveTable(list) : preTokenTable(list));
  }
  function updateCount(shown, isLive) {
    if (!countEl) return;
    countEl.textContent = shown + ' shown · ' + (isLive ? DATA.live_size + ' live-token' : DATA.board_size + ' ranked');
  }

  // ---------------------------------------------------------------- method

  function weightChip(label, weight, fallback) {
    return el('div', { class: 'weight' + (fallback ? ' weight-default' : '') },
      el('span', { class: 'weight-label', text: label }),
      el('b', { class: 'weight-value', text: weight.toFixed(2) + '×' })
    );
  }
  function note(title, text) {
    return el('div', { class: 'model-note' },
      el('h4', { text: title }),
      el('p', { text: text })
    );
  }
  function methodPanel() {
    var m = DATA.model;
    var formula = [
      'implied = TVL',
      '        × category weight',
      '        × (1 + clamp(7d growth, ' + m.growth_floor + '%, +' + m.growth_cap + '%) × ' + m.growth_weight + ')',
      '        × (' + m.age_floor.toFixed(2) + ' + min(age days, ' + m.age_full_days + ') ÷ ' + m.age_full_days + ' × ' + m.age_range.toFixed(2) + ')',
      '        × (1 + min(chains, ' + m.chain_cap + ') × ' + m.chain_step + ')',
      '        × (1 + min(funding ÷ ' + money(m.funding_full_usd) + ', 1) × ' + m.funding_weight + ')'
    ].join('\n');
    var weights = el('div', { class: 'weights' });
    DATA.category_rules.forEach(function (rule) { weights.appendChild(weightChip(rule.label, rule.weight, false)); });
    weights.appendChild(weightChip(DATA.default_category.label, DATA.default_category.weight, true));

    return el('section', { class: 'method', id: 'method' },
      el('div', { class: 'method-head' },
        el('p', { class: 'eyebrow', text: 'The model' }),
        el('h2', { text: 'One transparent function, no names hardcoded' }),
        el('p', {
          class: 'lede small',
          text: 'Every pre-token row is scored from the snapshot\u2019s own figures: TVL, seven-day growth, age without a token, chain count, category and, when present, disclosed funding. The watchlist is the coverage floor; the board also ranks ' + DATA.early_size + ' pre-token protocols the watchlist left out. Live-token protocols are held apart.'
        })
      ),
      el('div', { class: 'method-grid' },
        el('div', { class: 'formula-card' },
          el('h3', { text: 'The arithmetic' }),
          el('pre', { class: 'formula', text: formula })
        ),
        el('div', { class: 'weights-card' },
          el('h3', { text: 'Category weight table' }),
          el('p', { class: 'detail-sub', text: 'Categories are matched by keyword; the first match wins. An unmapped category uses ' + DATA.default_category.weight.toFixed(2) + '×.' }),
          weights
        )
      ),
      el('div', { class: 'model-notes' },
        note('Growth', 'Seven-day TVL growth is clamped to ' + m.growth_floor + '%..+' + m.growth_cap + '% and multiplied by ' + m.growth_weight + ', so momentum matters without letting one outlier week take over.'),
        note('Age', 'Days since DefiLlama first listed the protocol, the best record of how long it has run with no token. The multiplier rises from ' + m.age_floor.toFixed(2) + '× to ' + (m.age_floor + m.age_range).toFixed(2) + '× over ' + m.age_full_days + ' days; an unlisted age uses ' + m.unknown_age_days + ' days.'),
        note('Reach', 'Each chain adds ' + m.chain_step + '× up to ' + m.chain_cap + ' chains; multi-chain protocols reach more users and more farm surfaces.'),
        note('Funding', 'When a snapshot carries disclosed funding, up to ' + money(m.funding_full_usd) + ' adds ' + m.funding_weight + '× as a launch tailwind. This snapshot carries none, so every row uses 1.00×.')
      )
    );
  }

  function footer() {
    return el('footer', { class: 'footer' },
      el('div', null,
        el('strong', { text: 'Token Radar' }),
        el('span', { text: ' · model ' + DATA.model_version + ' · snapshot ' + DATA.as_of })
      ),
      el('p', {
        class: 'footer-note',
        text: 'Static page: reads ../data.js only. No fetch, no network, no external asset. Source: ' + DATA.source + '. Implied value is a model, not a price or a promise.'
      })
    );
  }

  // ---------------------------------------------------------------- detail drawer

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () {
    var slug = state.selected;
    state.selected = null;
    syncHash();
    renderBoard();
    if (slug) focusRow(slug);
  });
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) dialog.close();
  });
  function focusRow(slug) {
    var node = boardMount ? boardMount.querySelector('tr[data-slug="' + slug + '"]') : null;
    if (node && typeof node.focus === 'function') node.focus();
  }
  function findProtocol(slug) {
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].slug === slug) return { row: DATA.rows[i], live: false };
    }
    for (var j = 0; j < DATA.live.length; j++) {
      if (DATA.live[j].slug === slug) return { row: DATA.live[j], live: true };
    }
    return null;
  }
  function selectRow(slug) {
    state.selected = slug;
    syncHash();
    renderBoard();
    openDialog(slug);
  }
  function chip(text, cls) {
    return el('span', { class: 'chip' + (cls ? ' ' + cls : ''), text: text });
  }
  function fact(label, value) {
    return el('div', { class: 'fact' },
      el('span', { text: label }),
      el('b', { text: value })
    );
  }
  function detailHead(row, eyebrow, watch) {
    var chips = el('div', { class: 'chips' });
    chips.appendChild(chip(categoryOf(row), 'chip-cat'));
    (row.chains || []).slice(0, 4).forEach(function (c) { chips.appendChild(chip(c)); });
    if ((row.chains || []).length > 4) chips.appendChild(chip('+' + (row.chains.length - 4)));
    if (watch) chips.appendChild(chip('watchlist', 'chip-gold'));
    return el('div', { class: 'detail-top' },
      el('div', { class: 'detail-heading' },
        el('p', { class: 'eyebrow', text: eyebrow }),
        el('h2', { id: 'detail-title', text: row.name }),
        chips
      ),
      el('button', { type: 'button', class: 'icon-btn', text: 'Close', onclick: function () { dialog.close(); } })
    );
  }
  function breakdownPanel(row) {
    var box = el('div', { class: 'breakdown' });
    (row.breakdown || []).forEach(function (item) {
      box.appendChild(el('div', { class: 'breakdown-row' },
        el('span', { class: 'factor', text: item.factor }),
        el('span', { class: 'detail-text', text: item.detail }),
        el('span', { class: 'mult', text: item.multiplier === null || item.multiplier === undefined ? 'n/a' : '×' + item.multiplier.toFixed(3) })
      ));
    });
    box.appendChild(el('div', { class: 'breakdown-row total' },
      el('span', { class: 'factor', text: 'Implied value' }),
      el('span', { class: 'detail-text', text: DATA.model_version + ' · deterministic' }),
      el('span', { class: 'mult', text: money(row.implied_value_usd) })
    ));
    return el('section', { class: 'detail-section' },
      el('h3', { text: 'Value breakdown' }),
      box
    );
  }
  function farmPanel(row) {
    var list = el('ol', { class: 'plan' });
    (row.farm_plan || []).forEach(function (step, index) {
      list.appendChild(el('li', { class: 'plan-step' },
        el('span', { class: 'plan-num', text: String(index + 1) }),
        el('div', { class: 'plan-body' },
          el('p', { class: 'plan-action', text: step.action }),
          el('div', { class: 'chips' },
            el('span', { class: 'chip chip-cost', text: 'Cost · ' + step.cost }),
            el('span', { class: 'chip chip-time', text: 'Time · ' + step.time })
          )
        )
      ));
    });
    return el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('p', { class: 'detail-sub', text: 'Four concrete steps for ' + (row.category || 'this category') + ' on ' + ((row.chains || [])[0] || 'its main chain') + '. Costs are estimates in USD.' }),
      list
    );
  }

  function openDialog(slug) {
    var found = findProtocol(slug);
    if (!found) {
      state.selected = null;
      syncHash();
      return;
    }
    var row = found.row;
    var live = found.live;
    var inner = el('div', { class: 'detail-inner' });
    inner.appendChild(detailHead(row, live ? 'Live token' : 'Rank ' + row.rank + ' of ' + DATA.board_size, !live && row.on_watchlist));

    if (live) {
      inner.appendChild(el('div', { class: 'detail-implied' },
        el('span', { class: 'eyebrow', text: 'Market cap · live token' }),
        el('strong', { class: 'big-money', text: money(row.mcap_usd) }),
        el('span', { class: 'detail-sub', text: row.symbol ? row.symbol + ' already trades; no implied value is assigned.' : 'This token already trades; no implied value is assigned.' })
      ));
      inner.appendChild(el('div', { class: 'detail-facts' },
        fact('TVL', money(row.tvl_usd)),
        fact('7-day', pct(row.change_7d)),
        fact('Chains', String(row.chain_count)),
        fact('First listed', ageText(row.age_days))
      ));
      inner.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Why there is no implied value' }),
        el('p', {
          class: 'why',
          text: 'This protocol records a live token, so the market already prices it. Token Radar keeps live-token protocols strictly apart from the pre-token ranking and shows their market cap as a fact instead of running the implied-value model on them.'
        })
      ));
    } else {
      inner.appendChild(el('div', { class: 'detail-implied' },
        el('span', { class: 'eyebrow', text: 'Implied value' }),
        el('strong', { class: 'big-money', text: money(row.implied_value_usd) }),
        el('span', { class: 'detail-sub', text: 'base ' + money(row.base_usd) + ' after the ' + row.category_label + ' weight' })
      ));
      inner.appendChild(el('div', { class: 'detail-facts' },
        fact('TVL', money(row.tvl_usd)),
        fact('7-day', pct(row.change_7d)),
        fact('Without token', ageText(row.age_days)),
        fact('Chains', String(row.chain_count))
      ));
      inner.appendChild(breakdownPanel(row));
      inner.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Why this value' }),
        el('p', { class: 'why', text: row.explanation })
      ));
      inner.appendChild(farmPanel(row));
    }

    inner.appendChild(el('p', {
      class: 'detail-note',
      text: 'Model ' + DATA.model_version + '. An implied value is an estimate, not a price or a promise. This page reads out/data.js only; no network is used.'
    }));

    dialog.textContent = '';
    dialog.appendChild(inner);
    dialog.scrollTop = 0;
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
  }

  // ---------------------------------------------------------------- boot

  function init() {
    readHash();
    normalizeState();
    document.body.appendChild(dialog);

    var shell = el('div', { class: 'shell' });
    shell.appendChild(masthead());
    shell.appendChild(hero());
    shell.appendChild(toolbar());
    boardMount = el('section', { class: 'panel board-panel', id: 'board', tabindex: '-1' });
    shell.appendChild(boardMount);
    shell.appendChild(methodPanel());
    shell.appendChild(footer());
    root.appendChild(shell);
    root.setAttribute('aria-busy', 'false');

    renderBoard();
    syncHash();
    if (state.selected) openDialog(state.selected);
  }

  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && dialog.open) dialog.close();
  });

  init();
})();
