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
    group: 'pre-token',
    sort: 'implied',
    dir: -1,
    watchOnly: false,
    selected: null
  };

  var searchInput, chainSelect, watchToggle, groupButtons, countEl, boardMount, chipBar;

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
  function stepCost(step) {
    if (!step) return '';
    if (step.cost === 'free' || step.cost_usd === null || step.cost_usd === undefined) return 'free';
    if (typeof step.cost === 'string' && step.cost !== '') return step.cost;
    return money(step.cost_usd);
  }
  function stepTime(step) {
    if (!step) return '';
    if (typeof step.time === 'string' && step.time !== '') return step.time;
    return step.minutes + ' minute' + (step.minutes === 1 ? '' : 's');
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
        else if (key === 'style') node.setAttribute('style', value);
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

  var CATEGORY_LABELS = (function () {
    var out = [];
    var seen = {};
    function add(label) {
      if (!label || seen[label]) return;
      seen[label] = true;
      out.push(label);
    }
    (DATA.category_rules || []).forEach(function (rule) { add(rule.label); });
    if (DATA.default_category) add(DATA.default_category.label);
    (DATA.rows || []).forEach(function (r) { add(r.category_label); });
    return out;
  })();

  var CATEGORIES = (function () {
    var seen = {};
    (DATA.rows || []).forEach(function (r) { seen[categoryOf(r)] = true; });
    return Object.keys(seen).sort();
  })();

  var CHAINS = (function () {
    var counts = {};
    (DATA.rows || []).forEach(function (r) {
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
    var filter = params.get('filter') || params.get('group');
    if (filter === 'live' || filter === 'pre-token' || filter === 'all') state.group = filter;
    else if (filter) state.category = filter;
    if (params.get('cat')) state.category = params.get('cat');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('dir') === '1' || params.get('dir') === '-1') state.dir = Number(params.get('dir'));
    if (params.get('watch') === '1') state.watchOnly = true;
    var open = params.get('open') || params.get('p');
    if (open) state.selected = open;
  }
  function validSort(key) {
    return ['rank', 'name', 'category', 'chains', 'implied', 'tvl', 'growth', 'age', 'mcap'].indexOf(key) >= 0;
  }
  function defaultSort(group) {
    return group === 'live' ? 'mcap' : group === 'all' ? 'rank' : 'implied';
  }
  function normalizeState() {
    if (state.group !== 'live' && state.group !== 'pre-token' && state.group !== 'all') state.group = 'pre-token';
    if (state.category !== 'all' && CATEGORY_LABELS.indexOf(state.category) < 0 && CATEGORIES.indexOf(state.category) < 0) {
      state.category = 'all';
    }
    if (state.chain !== 'all' && CHAINS.indexOf(state.chain) < 0) state.chain = 'all';
    if (!validSort(state.sort)) state.sort = defaultSort(state.group);
    if (state.group === 'pre-token' && (state.sort === 'mcap' || state.sort === 'rank')) state.sort = 'implied';
    if (state.group === 'live' && (state.sort === 'implied' || state.sort === 'age')) state.sort = 'mcap';
    if (state.dir !== 1 && state.dir !== -1) state.dir = -1;
    if (state.sort === 'rank' && state.dir !== 1) state.dir = 1;
  }
  function syncHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('cat', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.group !== 'pre-token') params.set('filter', state.group);
    if (state.sort !== defaultSort(state.group)) params.set('sort', state.sort);
    if (state.dir !== (state.sort === 'rank' ? 1 : -1)) params.set('dir', String(state.dir));
    if (state.watchOnly) params.set('watch', '1');
    if (state.selected) params.set('open', state.selected);
    var next = params.toString();
    try {
      window.history.replaceState(null, '', next ? '#' + next : '#');
    } catch (e) {
      window.location.hash = next;
    }
  }

  // ---------------------------------------------------------------- filtering and sorting

  function categoryMatches(row) {
    if (state.category === 'all') return true;
    return row.category_label === state.category || categoryOf(row) === state.category;
  }
  function groupMatches(row) {
    if (state.group === 'all') return true;
    return row.token_status === state.group;
  }
  function filterList(list) {
    var q = state.q.trim().toLowerCase();
    return list.filter(function (r) {
      if (!groupMatches(r)) return false;
      if (state.watchOnly && !r.on_watchlist) return false;
      if (!categoryMatches(r)) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', r.category_label || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function valueFor(row, key) {
    var live = row.token_status === 'live';
    if (key === 'rank') return row.rank;
    if (key === 'name') return row.name.toLowerCase();
    if (key === 'category') return categoryOf(row).toLowerCase();
    if (key === 'chains') return (row.chains || []).length;
    if (key === 'tvl') return row.tvl_usd;
    if (key === 'growth') return row.change_7d;
    if (key === 'age') return row.age_days;
    if (key === 'mcap') return row.mcap_usd;
    if (key === 'implied') return live ? row.mcap_usd : row.implied_value_usd;
    return live ? row.mcap_usd : row.implied_value_usd;
  }
  function bySlug(a, b) {
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  }
  function sortRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av = valueFor(a, key);
      var bv = valueFor(b, key);
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
    var top = null;
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].token_status === 'pre-token') { top = DATA.rows[i]; break; }
    }
    return el('section', { class: 'hero' },
      el('p', { class: 'eyebrow', text: 'DefiLlama protocol index · ' + DATA.watchlist_size + '-slug watchlist' }),
      el('h1', null, 'The protocols that ', el('em', null, 'have not'), ' launched a token yet.'),
      el('p', {
        class: 'lede',
        text: 'Token Radar scores every pre-token protocol with one transparent function of TVL, seven-day growth, age without a token, chain reach and category. The watchlist is the floor; the board holds ' + DATA.board_pre_token_size + ' pre-token rows, including ' + DATA.early_size + ' the watchlist left out, beside ' + DATA.board_live_size + ' live-token rows that already trade.'
      }),
      el('div', { class: 'stats' },
        stat(DATA.protocols_scanned, 'Protocols scanned', 'DefiLlama index'),
        stat(DATA.board_pre_token_size, 'Pre-token', 'ranked by implied value'),
        stat(DATA.board_live_size, 'Live token', 'market cap, trades now'),
        stat(DATA.watchlist_covered + '/' + DATA.watchlist_size, 'Watchlist covered', top ? 'top ' + top.name : 'floor ' + money(DATA.floor_usd))
      )
    );
  }

  function switchGroup(group) {
    state.group = group;
    state.category = 'all';
    state.chain = 'all';
    state.watchOnly = false;
    state.sort = defaultSort(group);
    state.dir = state.sort === 'rank' ? 1 : -1;
    updateControls();
    updateChips();
    syncHash();
    renderBoard();
  }
  function resetFilters() {
    state.q = '';
    state.category = 'all';
    state.chain = 'all';
    state.watchOnly = false;
    updateControls();
    updateChips();
    syncHash();
    renderBoard();
  }
  function updateControls() {
    if (searchInput) searchInput.value = state.q;
    if (chainSelect) chainSelect.value = state.chain;
    if (watchToggle) watchToggle.checked = state.watchOnly;
    if (groupButtons) {
      Object.keys(groupButtons).forEach(function (key) {
        groupButtons[key].setAttribute('aria-pressed', state.group === key ? 'true' : 'false');
      });
    }
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

    groupButtons = {};
    var groupRow = el('div', { class: 'segmented' });
    [['all', 'All'], ['pre-token', 'Pre-token'], ['live', 'Live']].forEach(function (pair) {
      var button = el('button', {
        type: 'button', class: 'seg-btn', text: pair[1],
        'aria-pressed': state.group === pair[0] ? 'true' : 'false'
      });
      button.addEventListener('click', function () { switchGroup(pair[0]); });
      groupButtons[pair[0]] = button;
      groupRow.appendChild(button);
    });

    countEl = el('span', { class: 'result-count', 'aria-live': 'polite' });

    return el('section', { class: 'toolbar', 'aria-label': 'Board controls' },
      el('div', { class: 'field field-search' },
        el('label', { for: 'search', text: 'Search' }),
        searchInput
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
        el('span', { class: 'field-label', text: 'Group' }),
        groupRow
      ),
      el('div', { class: 'toolbar-tail' },
        countEl,
        el('button', { type: 'button', class: 'reset', text: 'Reset', onclick: resetFilters })
      )
    );
  }

  // ---------------------------------------------------------------- category chips

  function sourceForGroup() {
    return (DATA.rows || []).filter(groupMatches);
  }
  function countFor(value) {
    var source = sourceForGroup();
    if (value === 'all') return source.length;
    var n = 0;
    source.forEach(function (r) {
      if (r.category_label === value || categoryOf(r) === value) n++;
    });
    return n;
  }
  function chipButton(text, value) {
    var button = el('button', {
      type: 'button', class: 'cat-chip', 'data-cat': value,
      'aria-pressed': state.category === value ? 'true' : 'false'
    },
      el('span', { class: 'cat-chip-label', text: text }),
      el('b', { class: 'cat-chip-count', text: String(countFor(value)) })
    );
    button.addEventListener('click', function () {
      state.category = state.category === value ? 'all' : value;
      updateChips();
      syncHash();
      renderBoard();
    });
    return button;
  }
  function categoryChips() {
    chipBar = el('div', { class: 'chip-row', role: 'group', 'aria-label': 'Category filters' });
    chipBar.appendChild(chipButton('All categories', 'all'));
    CATEGORY_LABELS.forEach(function (label) { chipBar.appendChild(chipButton(label, label)); });
    return el('section', { class: 'chip-bar', 'aria-label': 'Category filters' },
      el('span', { class: 'chip-label', text: 'Category' }),
      chipBar
    );
  }
  function updateChips() {
    if (!chipBar) return;
    var buttons = chipBar.querySelectorAll('.cat-chip');
    for (var i = 0; i < buttons.length; i++) {
      var value = buttons[i].getAttribute('data-cat');
      buttons[i].setAttribute('aria-pressed', state.category === value ? 'true' : 'false');
      var count = buttons[i].querySelector('.cat-chip-count');
      if (count) count.textContent = String(countFor(value));
    }
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
      scope: 'col', class: cls + ' sortable',
      'aria-sort': active ? (state.dir === 1 ? 'ascending' : 'descending') : 'none'
    });
    var button = el('button', { type: 'button', class: 'sort-btn' }, label);
    button.appendChild(el('span', {
      class: 'sort-arrow' + (active ? ' is-active' : ''),
      'aria-hidden': 'true',
      text: active ? (state.dir === 1 ? '↑' : '↓') : '↕'
    }));
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

  function boardTable(list) {
    var tbody = el('tbody');
    var top = DATA.top_implied || 1;
    list.forEach(function (row) {
      var live = row.token_status === 'live';
      var tr = interactiveRow(row);
      tr.appendChild(el('td', { class: 'col-rank rank', text: String(row.rank) }));
      tr.appendChild(el('td', { class: 'col-proto' },
        el('div', { class: 'proto' },
          el('div', { class: 'proto-name' },
            el('b', { text: row.name }),
            live ? el('span', { class: 'watch-tag', title: 'This token already trades', text: row.symbol || 'live' })
              : row.on_watchlist ? el('span', { class: 'watch-tag', title: 'On the house watchlist', text: 'watchlist' }) : null
          ),
          el('span', { class: 'proto-slug', text: row.slug })
        )
      ));
      tr.appendChild(el('td', { class: 'col-cat' }, el('span', { class: 'tag', title: row.category_label, text: categoryOf(row) })));
      tr.appendChild(el('td', { class: 'col-chains' }, el('span', { class: 'chains', text: chainSummary(row.chains) })));
      if (live) {
        tr.appendChild(el('td', { class: 'col-implied' }, el('span', { class: 'status-live', text: 'trades now' })));
      } else {
        tr.appendChild(el('td', { class: 'col-implied' },
          el('div', { class: 'implied-cell' },
            el('div', { class: 'bar', 'aria-hidden': 'true' },
              el('i', { style: 'width:' + Math.min(100, Math.max(4, Math.round((row.implied_value_usd / top) * 100))) + '%' })
            ),
            el('strong', { class: 'money', text: money(row.implied_value_usd) })
          )
        ));
      }
      tr.appendChild(el('td', { class: 'col-tvl num', text: money(row.tvl_usd) }));
      tr.appendChild(el('td', { class: 'col-growth num ' + growthClass(row.change_7d), text: pct(row.change_7d) }));
      tr.appendChild(el('td', { class: 'col-age', text: live ? 'trades' : ageText(row.age_days) }));
      tr.appendChild(el('td', { class: 'col-mcap num', text: live ? money(row.mcap_usd) : '—' }));
      tbody.appendChild(tr);
    });

    return el('div', { class: 'panel-inner' },
      panelHead('Token board', 'Pre-token protocols are ranked by implied value; live-token protocols show their market cap and trade now. Select any row for details.'),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sr-only', text: 'Pre-token protocols ranked by implied value beside live-token protocols with their market cap' }),
          el('thead', null, el('tr', null,
            sortTh('rank', '#', 'col-rank'),
            sortTh('name', 'Protocol', 'col-proto'),
            sortTh('category', 'Category', 'col-cat'),
            sortTh('chains', 'Chains', 'col-chains'),
            sortTh('implied', 'Implied value', 'col-implied'),
            sortTh('tvl', 'TVL', 'col-tvl'),
            sortTh('growth', '7d', 'col-growth'),
            sortTh('age', 'Age / status', 'col-age'),
            sortTh('mcap', 'Market cap', 'col-mcap')
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
    var list = sortRows(filterList(DATA.rows || []));
    updateCount(list.length);
    if (list.length === 0) {
      boardMount.appendChild(emptyState());
      return;
    }
    boardMount.appendChild(boardTable(list));
  }
  function updateCount(shown) {
    if (!countEl) return;
    countEl.textContent = shown + ' shown · ' + DATA.board_pre_token_size + ' pre-token · ' + DATA.board_live_size + ' live';
  }

  // ---------------------------------------------------------------- method

  function categoryRange() {
    var values = Object.keys(DATA.weights.category).map(function (k) { return DATA.weights.category[k]; });
    return Math.min.apply(null, values).toFixed(2) + '–' + Math.max.apply(null, values).toFixed(2) + '×';
  }
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
    var w = DATA.weights;
    var formula = [
      'implied = TVL',
      '        × category multiple (' + categoryRange() + ')',
      '        × (1 + clamp(7d, −' + w.growth.capPct + '%, +' + w.growth.capPct + '%) × ' + w.growth.perPct + ')',
      '        × (' + w.age.floor.toFixed(2) + ' + min(age days, ' + w.age.fullDays + ') ÷ ' + w.age.fullDays + ' × ' + w.age.range.toFixed(2) + ')',
      '        × (1 + min(chains, ' + w.chain.cap + ') × ' + w.chain.step + ')'
    ].join('\n');
    var weights = el('div', { class: 'weights' });
    DATA.category_rules.forEach(function (rule) { weights.appendChild(weightChip(rule.label, rule.weight, false)); });
    weights.appendChild(weightChip(DATA.default_category.label, DATA.default_category.weight, true));

    return el('section', { class: 'method', id: 'method' },
      el('div', { class: 'method-head' },
        el('p', { class: 'eyebrow', text: 'The model' }),
        el('h2', { text: 'One transparent four-factor function, no names hardcoded' }),
        el('p', {
          class: 'lede small',
          text: 'Every pre-token row is scored from the snapshot\u2019s own figures: TVL, seven-day growth, age without a token, chain count and category. The watchlist is the coverage floor; the board also ranks ' + DATA.early_size + ' pre-token protocols the watchlist left out. Live-token rows sit on the same board with the market cap they state and never an implied value.'
        })
      ),
      el('div', { class: 'method-grid' },
        el('div', { class: 'formula-card' },
          el('h3', { text: 'The arithmetic' }),
          el('pre', { class: 'formula', text: formula })
        ),
        el('div', { class: 'weights-card' },
          el('h3', { text: 'Category multiple table' }),
          el('p', { class: 'detail-sub', text: 'Categories are matched by keyword at word boundaries; the first match wins. An unmapped category uses ' + DATA.default_category.weight.toFixed(2) + '×.' }),
          weights
        )
      ),
      el('div', { class: 'model-notes' },
        note('Growth', 'Seven-day TVL growth is capped at ' + w.growth.capPct + '% in either direction, then scaled by ' + w.growth.perPct + ' per point. The factor therefore runs from ' + (1 - w.growth.capPct * w.growth.perPct).toFixed(2) + '× to ' + (1 + w.growth.capPct * w.growth.perPct).toFixed(2) + '×, so one outlier week cannot dominate.'),
        note('Age', 'Days since DefiLlama first listed the protocol, the snapshot\u2019s record of operation without a token. The factor rises from ' + w.age.floor.toFixed(2) + '× to ' + (w.age.floor + w.age.range).toFixed(2) + '× over ' + w.age.fullDays + ' days and then saturates; an unlisted age uses ' + w.age.unknownDays + ' days.'),
        note('Reach', 'Each chain adds ' + w.chain.step + '× up to ' + w.chain.cap + ' chains. The premium is deliberately small and bounded: reach matters, but it cannot outrank a weak category.'),
        note('Funding', 'This snapshot carries no disclosed funding, so no funding factor is applied. When a snapshot does carry it, the row records it beside the four factors rather than hiding it in the score.')
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
      if (DATA.rows[i].slug === slug) return { row: DATA.rows[i], live: DATA.rows[i].token_status === 'live' };
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
  function maxCategory() {
    var c = DATA.weights.category;
    var max = 0;
    Object.keys(c).forEach(function (k) { if (c[k] > max) max = c[k]; });
    return max || 1;
  }
  function maxGrowth() {
    var g = DATA.weights.growth;
    return 1 + g.capPct * g.perPct;
  }
  function maxAge() {
    var a = DATA.weights.age;
    return a.floor + a.range;
  }
  function maxChain() {
    var c = DATA.weights.chain;
    return 1 + c.cap * c.step;
  }
  function factorLine(factor, max) {
    var multiplier = factor && isFinite(factor.multiplier) ? factor.multiplier : 0;
    var pct = Math.max(2, Math.min(100, Math.round((multiplier / (max || 1)) * 100)));
    return el('div', { class: 'factor-row' },
      el('div', { class: 'factor-head' },
        el('span', { class: 'factor-label', text: factor ? factor.label : 'Factor' }),
        el('span', { class: 'factor-value', text: '×' + multiplier.toFixed(3) })
      ),
      el('div', {
        class: 'factor-track',
        role: 'img',
        'aria-label': (factor ? factor.label : 'Factor') + ' multiplier ' + multiplier.toFixed(3)
      }, el('i', { class: 'factor-fill', style: 'width:' + pct + '%' })),
      el('span', { class: 'factor-detail', text: factor ? factor.detail : '' })
    );
  }
  function breakdownPanel(row) {
    var b = row.breakdown || {};
    var box = el('div', { class: 'factor-list' });
    box.appendChild(factorLine(b.category, maxCategory()));
    box.appendChild(factorLine(b.growth, maxGrowth()));
    box.appendChild(factorLine(b.age, maxAge()));
    box.appendChild(factorLine(b.chain, maxChain()));
    return el('section', { class: 'detail-section' },
      el('h3', { text: 'Value breakdown' }),
      el('p', { class: 'detail-sub', text: 'Each bar is the factor against its own maximum.' }),
      box
    );
  }
  function farmPanel(row) {
    var tbody = el('tbody');
    (row.farm_plan || []).forEach(function (step, index) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'plan-index', text: String(index + 1) }),
        el('td', { class: 'plan-action-cell', text: step.action }),
        el('td', { class: 'plan-cost', text: stepCost(step) }),
        el('td', { class: 'plan-time', text: stepTime(step) })
      ));
    });
    return el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('p', { class: 'detail-sub', text: 'Four concrete steps for ' + (row.category || 'this category') + ' on ' + ((row.chains || [])[0] || 'its main chain') + '. Cost is out-of-pocket USD; time is in minutes.' }),
      el('div', { class: 'plan-wrap' },
        el('table', { class: 'plan-table' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', class: 'plan-index', text: '#' }),
            el('th', { scope: 'col', text: 'Action' }),
            el('th', { scope: 'col', class: 'plan-cost', text: 'Cost' }),
            el('th', { scope: 'col', class: 'plan-time', text: 'Time' })
          )),
          tbody
        )
      )
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
        el('h3', { text: 'Chains' }),
        el('p', { class: 'detail-sub', text: 'Every chain the snapshot records TVL on for ' + row.name + '.' }),
        el('div', { class: 'chips' }, (row.chains && row.chains.length) ? row.chains.map(function (c) { return chip(c); }) : [chip('No chain recorded')])
      ));
      inner.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Why there is no implied value' }),
        el('p', {
          class: 'why',
          text: 'This protocol records a live token, so the market already prices it. Token Radar shows the market cap and chain list as facts and does not run the implied-value model on it.'
        })
      ));
    } else {
      inner.appendChild(el('div', { class: 'detail-implied' },
        el('span', { class: 'eyebrow', text: 'Implied value' }),
        el('strong', { class: 'big-money', text: money(row.implied_value_usd) }),
        el('span', { class: 'detail-sub', text: 'base ' + money(row.base_usd) + ' after the ' + row.category_label + ' multiple' })
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
        el('p', { class: 'why', text: (row.breakdown && row.breakdown.why) || row.explanation })
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
    shell.appendChild(categoryChips());
    boardMount = el('section', { class: 'panel board-panel', id: 'board', tabindex: '-1' });
    shell.appendChild(boardMount);
    shell.appendChild(methodPanel());
    shell.appendChild(footer());
    root.appendChild(shell);
    root.setAttribute('aria-busy', 'false');

    renderBoard();
    updateChips();
    syncHash();
    if (state.selected) openDialog(state.selected);
  }

  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && dialog.open) dialog.close();
  });

  init();
})();
