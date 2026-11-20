/* =========================================================
 * 오늘 어디가? — 앱 로직
 *  - 해시 라우팅(#/travel, #/subway, .../all, .../p/이름)
 *  - history.pushState 기반 뒤로가기 처리 (깊이 d 추적)
 *  - 서비스워커 자동 업데이트 감지
 * ========================================================= */
(function () {
  'use strict';

  /* ---------- 유틸 ---------- */
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var enc = encodeURIComponent;
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem('wtg.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem('wtg.' + k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 무시 */ } }
  };
  function rnd(n) {
    if (window.crypto && window.crypto.getRandomValues) {
      var a = new Uint32Array(1); window.crypto.getRandomValues(a); return a[0] % n;
    }
    return Math.floor(Math.random() * n);
  }
  function norm(s) { return String(s).toLowerCase().replace(/\s+/g, ''); }

  /* ---------- 상수 ---------- */
  var CAT = {
    '먹': { e: '🍜', n: '먹거리' }, '카페': { e: '☕', n: '카페' }, '놀': { e: '🎡', n: '놀거리' },
    '볼': { e: '🏛️', n: '볼거리' }, '걷': { e: '🌿', n: '산책' }, '쇼': { e: '🛍️', n: '쇼핑' }
  };
  var ZONE = { '서울': '수도권', '경기': '수도권', '인천': '수도권', '세종': '충청', '광주': '전라', '강원': '강원', '충북': '충청', '충남': '충청', '대전': '충청',
    '전북': '전라', '전남': '전라', '경북': '경상', '경남': '경상', '대구': '경상', '부산': '경상', '울산': '경상', '제주': '제주' };
  var ZONES = ['수도권', '강원', '충청', '전라', '경상', '제주'];
  var TYPES = ['바다', '산·자연', '도시', '역사·전통', '섬'];
  var REGIONS = ['서울', '경기', '인천', '부산', '대구', '대전', '광주'];
  var CATS = ['먹', '카페', '놀', '볼', '걷', '쇼'];
  var LINE_COLOR = {
    '1': '#0052A4', '2': '#00A84D', '3': '#EF7C1C', '4': '#00A5DE', '5': '#996CAC', '6': '#CD7C2F', '7': '#747F00',
    '8': '#E6186C', '9': '#BDB092', '신분당': '#D4003B', '수인분당': '#FABE00', '경의중앙': '#77C4A3', '공항철도': '#0090D2',
    '경춘': '#0C8E72', '경강': '#0054A6', '에버라인': '#56AD2D', '인천1': '#7CA8D5', '우이신설': '#B0CE18', '신림선': '#6789CA',
    '부산1': '#F06A00', '부산2': '#3FAE49', '부산3': '#BB8C00', '부산4': '#217DCB', '동해선': '#0054A6', '대구1': '#D93F5C', '대구2': '#00A07A', '대구3': '#E5A100', '대전1': '#007448', '광주1': '#009088',
    'KTX': '#6b7089', 'GTX-A': '#9A6292', 'SRT': '#A5263B'
  };
  var DARK_INK = { '9': 1, '수인분당': 1, '경의중앙': 1, '인천1': 1, '우이신설': 1 };

  /* ---------- 데이터 파싱 ---------- */
  var TRAVEL = (window.RAW_TRAVEL || []).map(function (r) {
    return {
      id: r[0], name: r[0], region: r[1], zone: ZONE[r[1]] || r[1], types: r[2].split(','), desc: r[3], season: r[4],
      spots: r[5].map(function (s) { var p = s.split('|'); return { name: p[0], desc: p[1] || '' }; })
    };
  });
  var NAME_COUNT = {};
  (window.RAW_STATIONS || []).forEach(function (r) { NAME_COUNT[r[0]] = (NAME_COUNT[r[0]] || 0) + 1; });
  var STATIONS = (window.RAW_STATIONS || []).map(function (r) {
    return {
      id: NAME_COUNT[r[0]] > 1 ? r[0] + '~' + r[2] : r[0], name: r[0], lines: r[1].split('·'), region: r[2],
      spots: r.slice(3).map(function (s) { var p = s.split('|'); return { cat: p[0], name: p[1], desc: p[2] || '' }; })
    };
  });

  var KIND = {
    travel: {
      label: '랜덤 여행지', noun: '여행지', unit: '곳', items: TRAVEL,
      groups: [
        { key: 'zone', label: '권역', values: ZONES, match: function (it, v) { return it.zone === v; } },
        { key: 'type', label: '유형', values: TYPES, match: function (it, v) { return it.types.indexOf(v) >= 0; } }
      ]
    },
    subway: {
      label: '랜덤 지하철', noun: '지하철역', unit: '곳', items: STATIONS,
      groups: [
        { key: 'region', label: '지역', values: REGIONS, match: function (it, v) { return it.region === v; } },
        { key: 'cat', label: '하고 싶은 것', values: CATS, labelOf: function (c) { return CAT[c].e + ' ' + CAT[c].n; },
          match: function (it, v) { return it.spots.some(function (s) { return s.cat === v; }); } }
      ]
    }
  };
  function byId(kind, id) {
    var arr = KIND[kind].items;
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  /* ---------- 찜 / 가봤어요 / 제외 (기기에만 저장) ---------- */
  function flag(name) {
    return {
      list: function (kind) { return store.get(name + '.' + kind, []); },
      has: function (kind, id) { return this.list(kind).indexOf(id) >= 0; },
      toggle: function (kind, id) {
        var a = this.list(kind); var i = a.indexOf(id);
        if (i >= 0) a.splice(i, 1); else a.push(id);
        store.set(name + '.' + kind, a); return i < 0;
      }
    };
  }
  var FAV = flag('fav'), VISITED = flag('visited'), BAN = flag('ban');

  /* ---------- 필터 / 후보 ---------- */
  function getFilter(kind) { return store.get('f.' + kind, {}); }
  function matches(kind, it) {
    var f = getFilter(kind);
    return KIND[kind].groups.every(function (g) {
      var sel = (f[g.key] || []).filter(function (v) { return g.values.indexOf(v) >= 0; });
      return !sel.length || sel.some(function (v) { return g.match(it, v); });
    });
  }
  function onlyNew(kind) { return store.get('new.' + kind, false) === true; }
  function candidates(kind) {
    var nw = onlyNew(kind);
    return KIND[kind].items.filter(function (it) {
      return matches(kind, it) && !BAN.has(kind, it.id) && !(nw && VISITED.has(kind, it.id));
    });
  }
  function toggleFilter(kind, key, v) {
    var f = getFilter(kind); var a = f[key] || []; var i = a.indexOf(v);
    if (i >= 0) a.splice(i, 1); else a.push(v);
    f[key] = a; store.set('f.' + kind, f);
  }
  function filtersHTML(kind, extra) {
    var f = getFilter(kind);
    var h = KIND[kind].groups.map(function (g) {
      var sel = f[g.key] || [];
      return '<h3>' + esc(g.label) + '</h3><div class="chips">' + g.values.map(function (v) {
        return '<button type="button" class="chip" data-act="chip" data-g="' + g.key + '" data-v="' + esc(v) + '" aria-pressed="' +
          (sel.indexOf(v) >= 0) + '">' + esc(g.labelOf ? g.labelOf(v) : v) + '</button>';
      }).join('') + '</div>';
    }).join('');
    return h + (extra || '');
  }

  /* ---------- 최근 ---------- */
  function recent(kind) { return store.get('recent.' + kind, []); }
  function pushRecent(kind, id) {
    var a = recent(kind).filter(function (x) { return x !== id; }); a.unshift(id);
    store.set('recent.' + kind, a.slice(0, 12));
  }
  function pickTarget(kind, pool, currentId) {
    var avoidN = Math.min(6, Math.floor(pool.length / 2));
    var avoid = recent(kind).slice(0, avoidN); if (currentId) avoid.push(currentId);
    var fresh = pool.filter(function (it) { return avoid.indexOf(it.id) < 0; });
    if (!fresh.length) fresh = pool.filter(function (it) { return it.id !== currentId; });
    if (!fresh.length) fresh = pool;
    return fresh[rnd(fresh.length)];
  }

  /* ---------- 지도 링크 ---------- */
  function naver(q) { return 'https://map.naver.com/p/search/' + enc(q); }
  function kakao(q) { return 'https://map.kakao.com/link/search/' + enc(q); }
  function stationLabel(n) { return /역$/.test(n) ? n : n + '역'; }
  function stationQuery(n) { return stationLabel(n).replace(/·/g, ''); }

  /* ---------- 토스트 ---------- */
  var toastTimer = null;
  function toast(msg, actionLabel, action, ms) {
    var t = $('#toast'); t.innerHTML = '';
    var s = document.createElement('span'); s.textContent = msg; t.appendChild(s);
    if (actionLabel) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = actionLabel;
      b.addEventListener('click', function () { t.hidden = true; if (action) action(); });
      t.appendChild(b);
    }
    t.hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || (actionLabel ? 8000 : 2600));
  }

  /* ---------- 화면 조각(HTML) ---------- */
  function lineLabel(l) {
    var m = /^(부산|대구|대전|광주)(\d)$/.exec(l);
    if (m) return m[1] + ' ' + m[2] + '호선';
    return /^\d$/.test(l) ? l + '호선' : l;
  }
  function lineBadge(l) {
    var label = lineLabel(l);
    return '<span class="badge line' + (DARK_INK[l] ? ' dark-ink' : '') + '" style="background:' + (LINE_COLOR[l] || '#6b7089') + '">' + esc(label) + '</span>';
  }
  function spotHTML(icon, s, kindLabel) {
    var q = s.name;
    return '<li class="spot"><div class="spot-ico" aria-hidden="true">' + icon + '</div><div><div class="spot-name">' + esc(s.name) +
      '</div><div class="spot-desc">' + (kindLabel ? esc(kindLabel) + (s.desc ? ' · ' : '') : '') + esc(s.desc) + '</div></div>' +
      '<div class="spot-links"><a href="' + naver(q) + '" target="_blank" rel="noopener noreferrer">네이버지도</a>' +
      '<a href="' + kakao(q) + '" target="_blank" rel="noopener noreferrer">카카오맵</a></div></li>';
  }
  function actionsHTML(kind, it) {
    var fav = FAV.has(kind, it.id), vis = VISITED.has(kind, it.id), ban = BAN.has(kind, it.id);
    var a = ' data-kind="' + kind + '" data-id="' + esc(it.id) + '"';
    return '<div class="btn-row three">' +
      '<button type="button" class="btn primary" data-act="reroll"' + a + '>🎲 다시 뽑기</button>' +
      '<button type="button" class="btn' + (fav ? ' on' : '') + '" data-act="fav"' + a + ' aria-pressed="' + fav + '">' + (fav ? '♥ 찜함' : '♡ 찜') + '</button>' +
      '<button type="button" class="btn" data-act="share"' + a + '>🔗 링크 공유</button></div>' +
      '<div class="btn-row three">' +
      '<button type="button" class="btn' + (vis ? ' on' : '') + '" data-act="visit"' + a + ' aria-pressed="' + vis + '">' + (vis ? '✓ 가봤어요' : '☐ 가봤어요') + '</button>' +
      '<button type="button" class="btn' + (ban ? ' on' : '') + '" data-act="ban"' + a + ' aria-pressed="' + ban + '">' + (ban ? '🚫 제외됨' : '🚫 제외') + '</button>' +
      '<button type="button" class="btn" data-act="card"' + a + '>🖼 카드 저장</button></div>';
  }

  function homeHTML(kind) {
    var K = KIND[kind]; var pool = candidates(kind);
    var isT = kind === 'travel';
    var fv = FAV.list(kind).map(function (id) { return byId(kind, id); }).filter(Boolean);
    var rc = recent(kind).map(function (id) { return byId(kind, id); }).filter(Boolean).slice(0, 6);
    function minis(arr) {
      return '<div class="mini-list">' + arr.map(function (it) {
        return '<a class="mini" href="#/' + kind + '/p/' + enc(it.id) + '">' + esc(kind === 'subway' ? stationLabel(it.name) : it.name) + '</a>';
      }).join('') + '</div>';
    }
    return '<section class="hero"><div class="hero-emoji" aria-hidden="true">' + (isT ? '🧭' : '🚇') + '</div>' +
      '<h2>' + (isT ? '이번엔 어디로 떠날까요?' : '오늘은 어느 역에서 놀까요?') + '</h2>' +
      '<p>' + (isT ? '국내 여행지를 랜덤으로 골라드려요' : '전국 지하철역과 주변 놀거리를 골라드려요') + '</p>' +
      '<div class="filters" id="flt">' + filtersHTML(kind, homeExtra(kind)) + '</div>' +
      '<div class="count-note" id="cnt"></div><div class="stats" id="stats"></div>' +
      '<button type="button" class="cta" id="rollBtn" data-act="roll" data-kind="' + kind + '">🎲 랜덤으로 뽑기</button>' +
      '<a class="link-more" href="#/' + kind + '/all">전체 ' + K.items.length + K.unit + ' 한눈에 보기 →</a></section>' +
      (rc.length ? '<h3 class="section-title">최근 뽑은 ' + K.noun + '</h3>' + minis(rc) : '') +
      (fv.length ? '<h3 class="section-title">♥ 찜한 ' + K.noun + '</h3>' + minis(fv) : '') +
      '<div id="install"></div>';
  }
  function homeExtra(kind) {
    return '<h3>뽑기 옵션</h3><div class="chips"><button type="button" class="chip" data-act="onlynew" data-kind="' + kind +
      '" aria-pressed="' + onlyNew(kind) + '">✨ 안 가본 곳만</button></div>';
  }
  function refreshHome(kind) {
    var pool = candidates(kind); var K = KIND[kind];
    var flt = $('#flt'); if (flt) flt.innerHTML = filtersHTML(kind, homeExtra(kind));
    var c = $('#cnt');
    if (c) c.textContent = pool.length ? '조건에 맞는 ' + K.noun + ' ' + pool.length + K.unit : '뽑을 수 있는 곳이 없어요. 조건을 줄여 보세요';
    var b = $('#rollBtn'); if (b) b.disabled = !pool.length;
    var st = $('#stats');
    if (st) {
      var v = VISITED.list(kind).filter(function (id) { return byId(kind, id); }).length;
      var n = BAN.list(kind).filter(function (id) { return byId(kind, id); }).length;
      st.innerHTML = '✓ 가본 곳 ' + v + ' / ' + K.items.length + (n ? ' · <button type="button" class="linkbtn" data-act="showban" data-kind="' + kind + '">🚫 제외한 곳 ' + n + '</button>' : '');
    }
  }

  function travelDetailHTML(it) {
    return '<article class="result"><div class="kicker">🎲 오늘의 여행지</div><h2>' + esc(it.name) + '</h2>' +
      '<div class="badges"><span class="badge region">' + esc(it.region) + '</span>' +
      it.types.map(function (t) { return '<span class="badge">' + esc(t) + '</span>'; }).join('') +
      '<span class="badge">🗓 ' + esc(it.season) + '</span></div>' +
      '<p class="desc">' + esc(it.desc) + '</p>' +
      '<h3 class="section-title">가볼 만한 곳</h3><ul class="spots">' +
      it.spots.map(function (s) { return spotHTML('📍', s); }).join('') + '</ul>' +
      actionsHTML('travel', it) +
      '<div class="btn-row three">' +
      '<a class="btn" href="' + naver(it.name + ' 맛집') + '" target="_blank" rel="noopener noreferrer">🍽 맛집 찾기</a>' +
      '<a class="btn" href="' + naver(it.name + ' 숙소') + '" target="_blank" rel="noopener noreferrer">🛏 숙소 찾기</a></div>' +
      '<p class="hint">운영 시간·휴무·요금은 방문 전에 한 번 확인해 주세요.</p></article>';
  }
  function subwayDetailHTML(it) {
    var q = stationQuery(it.name);
    return '<article class="result"><div class="kicker">🎲 오늘의 지하철역</div><h2>' + esc(stationLabel(it.name)) + '</h2>' +
      '<div class="badges"><span class="badge region">' + esc(it.region) + '</span>' + it.lines.map(lineBadge).join('') + '</div>' +
      '<p class="desc">이 역 근처에서 이런 걸 해보세요.</p>' +
      '<ul class="spots">' + it.spots.map(function (s) {
        var c = CAT[s.cat] || { e: '📍', n: '' };
        return spotHTML(c.e, s, c.n);
      }).join('') + '</ul>' +
      actionsHTML('subway', it) +
      '<h3 class="section-title">이 역 주변 더 찾기</h3><div class="btn-row three">' +
      '<a class="btn" href="' + naver(q + ' 맛집') + '" target="_blank" rel="noopener noreferrer">🍜 맛집</a>' +
      '<a class="btn" href="' + naver(q + ' 카페') + '" target="_blank" rel="noopener noreferrer">☕ 카페</a>' +
      '<a class="btn" href="' + naver(q + ' 가볼만한곳') + '" target="_blank" rel="noopener noreferrer">📍 가볼만한 곳</a></div>' +
      '<p class="hint">일부 장소는 역에서 도보·버스 이동이 필요해요. 운영 여부는 방문 전에 확인해 주세요.</p></article>';
  }

  var listState = { q: '', fav: false, visited: false, ban: false };
  function listHTML(kind) {
    return '<div class="searchbox"><input id="q" type="search" enterkeyhint="search" autocomplete="off" aria-label="검색" ' +
      'placeholder="' + (kind === 'travel' ? '여행지·지역·장소 검색' : '역·노선·장소 검색') + '" value="' + esc(listState.q) + '"></div>' +
      '<div class="filters" id="flt"></div><div id="list"></div>';
  }
  function paintListFilters(kind) {
    var extra = '<h3>보기</h3><div class="chips">' +
      '<button type="button" class="chip" data-act="favonly" aria-pressed="' + listState.fav + '">♥ 찜한 곳</button>' +
      '<button type="button" class="chip" data-act="visitedonly" aria-pressed="' + listState.visited + '">✓ 가본 곳</button>' +
      '<button type="button" class="chip" data-act="banonly" aria-pressed="' + listState.ban + '">🚫 제외한 곳</button></div>';
    var f = $('#flt'); if (f) f.innerHTML = filtersHTML(kind, extra);
  }
  function itemHTML(kind, it) {
    var href = '#/' + kind + '/p/' + enc(it.id);
    var banned = BAN.has(kind, it.id);
    var marks = '<span class="marks">' + (FAV.has(kind, it.id) ? '<span class="fav-mark" aria-label="찜">♥</span>' : '') +
      (VISITED.has(kind, it.id) ? '<span class="badge ok">✓ 가봄</span>' : '') +
      (banned ? '<span class="badge no">🚫 제외</span>' : '') + '</span>';
    var cls = 'item' + (banned ? ' banned' : '');
    if (kind === 'travel') {
      return '<a class="' + cls + '" href="' + href + '"><div class="item-top"><span class="item-name">' + esc(it.name) + '</span>' + marks +
        '</div><div class="badges"><span class="badge region">' + esc(it.region) + '</span>' +
        it.types.map(function (t) { return '<span class="badge">' + esc(t) + '</span>'; }).join('') + '</div>' +
        '<div class="item-sub">' + esc(it.desc) + '</div></a>';
    }
    return '<a class="' + cls + '" href="' + href + '"><div class="item-top"><span class="item-name">' + esc(stationLabel(it.name)) + '</span>' + marks +
      '</div><div class="badges">' + it.lines.map(lineBadge).join('') + '</div><div class="item-sub">' +
      it.spots.map(function (s) { return (CAT[s.cat] ? CAT[s.cat].e : '📍') + ' ' + esc(s.name); }).join(' · ') + '</div></a>';
  }
  function paintList(kind) {
    var K = KIND[kind]; var q = norm(listState.q);
    var items = K.items.filter(function (it) {
      if (!matches(kind, it)) return false;
      if (listState.fav && !FAV.has(kind, it.id)) return false;
      if (listState.visited && !VISITED.has(kind, it.id)) return false;
      if (listState.ban && !BAN.has(kind, it.id)) return false;
      if (!q) return true;
      var hay = it.name + it.region + (it.lines ? it.lines.join('') : '') + (it.types ? it.types.join('') : '') +
        it.spots.map(function (s) { return s.name + s.desc; }).join('');
      return norm(hay).indexOf(q) >= 0;
    });
    var order = kind === 'travel' ? ZONES : REGIONS;
    var keyOf = function (it) { return kind === 'travel' ? it.zone : it.region; };
    var h = '';
    order.forEach(function (g) {
      var arr = items.filter(function (it) { return keyOf(it) === g; })
        .sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
      if (!arr.length) return;
      h += '<div class="group-title"><span>' + esc(g) + '</span><span>' + arr.length + K.unit + '</span></div><div class="grid">' +
        arr.map(function (it) { return itemHTML(kind, it); }).join('') + '</div>';
    });
    var el = $('#list');
    if (el) el.innerHTML = h || '<p class="empty">조건에 맞는 ' + K.noun + '이(가) 없어요.<br>필터나 검색어를 바꿔 보세요.</p>';
  }

  /* ---------- 라우팅 / 뒤로가기 ---------- */
  var app = $('#app'); var titleEl = $('#title'); var backBtn = $('#back');
  var route = { kind: 'travel', type: 'home', id: null };
  var renderedHash = null; var curKey = ''; var scrolls = {};

  function parseRoute() {
    var parts = (location.hash || '').replace(/^#\/?/, '').split('/');
    var kind = parts[0] === 'subway' ? 'subway' : 'travel';
    if (parts[1] === 'all') return { kind: kind, type: 'list' };
    if (parts[1] === 'p' && parts[2]) {
      var id; try { id = decodeURIComponent(parts[2]); } catch (e) { id = parts[2]; }
      return { kind: kind, type: 'detail', id: id };
    }
    return { kind: kind, type: 'home' };
  }
  function depth() { return (history.state && history.state.d) || 0; }

  function go(hash, opts) {
    opts = opts || {};
    var d = depth();
    if (opts.replace) history.replaceState({ d: d }, '', hash);
    else history.pushState({ d: d + 1 }, '', hash);
    render(false);
  }
  function goBack() {
    if (depth() > 0) history.back();
    else go('#/' + route.kind, { replace: true });
  }

  function render(restore) {
    cancelSpin();
    route = parseRoute();
    renderedHash = location.hash; curKey = location.hash;
    var kind = route.kind; var K = KIND[kind]; var html = ''; var title = '오늘 어디가?';

    if (route.type === 'home') {
      html = homeHTML(kind);
    } else if (route.type === 'list') {
      html = listHTML(kind); title = kind === 'travel' ? '전체 여행지' : '전체 지하철역';
    } else {
      var it = byId(kind, route.id);
      if (!it) { toast('찾는 ' + K.noun + '이(가) 없어요'); history.replaceState({ d: depth() }, '', '#/' + kind); route = parseRoute(); renderedHash = location.hash; curKey = location.hash; html = homeHTML(kind); }
      else { html = kind === 'travel' ? travelDetailHTML(it) : subwayDetailHTML(it); title = K.label; }
    }
    app.innerHTML = html;
    app.classList.remove('page-in'); void app.offsetWidth; app.classList.add('page-in');
    titleEl.textContent = title;
    backBtn.hidden = route.type === 'home';
    document.title = (route.type === 'detail' && it ? (kind === 'subway' ? stationLabel(it.name) : it.name) + ' – ' : '') + '오늘 어디가?';
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (a) {
      if (a.getAttribute('data-tab') === route.kind) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });

    if (route.type === 'home') { refreshHome(kind); paintInstall(); }
    if (route.type === 'list') { paintListFilters(kind); paintList(kind); }
    window.scrollTo(0, restore ? (scrolls[curKey] || 0) : 0);
  }

  window.addEventListener('scroll', function () { scrolls[curKey] = window.scrollY; }, { passive: true });
  function onNav() { if (location.hash !== renderedHash) render(true); }
  window.addEventListener('popstate', onNav);
  window.addEventListener('hashchange', onNav);

  /* ---------- 룰렛 ---------- */
  var spinTimer = null;
  function cancelSpin() {
    if (spinTimer) { clearTimeout(spinTimer); spinTimer = null; }
    var o = $('.spin'); if (o) o.remove();
  }
  function spin(kind, currentId) {
    var pool = candidates(kind);
    if (!pool.length) { toast('조건에 맞는 곳이 없어요. 필터를 줄여 보세요'); return; }
    var target = pickTarget(kind, pool, currentId);
    pushRecent(kind, target.id);
    var label = function (it) { return kind === 'subway' ? stationLabel(it.name) : it.name; };
    function finish() {
      if (navigator.vibrate) { try { navigator.vibrate(20); } catch (e) { /* 무시 */ } }
      go('#/' + kind + '/p/' + enc(target.id), { replace: !!currentId });
    }
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || pool.length === 1) { finish(); return; }

    var o = document.createElement('div'); o.className = 'spin'; o.setAttribute('role', 'status');
    o.innerHTML = '<div><div class="spin-dice" aria-hidden="true">🎲</div><div class="spin-label">두근두근…</div><div class="spin-name" id="spName"></div></div>';
    document.body.appendChild(o);
    var nameEl = $('#spName'); var start = Date.now(); var total = 1500;
    (function tick() {
      var t = Date.now() - start;
      if (t >= total) {
        nameEl.textContent = label(target); o.classList.add('done'); $('.spin-label', o).textContent = '당첨!';
        spinTimer = setTimeout(finish, 600); return;
      }
      nameEl.textContent = label(pool[rnd(pool.length)]);
      spinTimer = setTimeout(tick, 60 + (t / total) * 170);
    })();
  }

  /* ---------- 설치 / 공유 ---------- */
  var deferredPrompt = null;
  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }
  function paintInstall() {
    var el = $('#install'); if (!el || isStandalone()) return;
    if (deferredPrompt) {
      el.innerHTML = '<h3 class="section-title">앱처럼 쓰기</h3><button type="button" class="btn" data-act="install">📲 홈 화면에 설치하기</button>';
    } else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
      el.innerHTML = '<p class="hint">Safari 공유 버튼 ▸ “홈 화면에 추가”로 앱처럼 쓸 수 있어요.</p>';
    }
  }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredPrompt = e; paintInstall(); });
  window.addEventListener('appinstalled', function () { deferredPrompt = null; toast('설치가 끝났어요!'); paintInstall(); });

  function share(kind, id) {
    var it = byId(kind, id); if (!it) return;
    var nm = kind === 'subway' ? stationLabel(it.name) : it.name;
    var text = (kind === 'subway' ? '오늘은 ' + nm + '에서 놀자! ' : '이번엔 ' + nm + ' 어때? ') + '(오늘 어디가?)';
    var url = location.href;
    if (navigator.share) { navigator.share({ title: '오늘 어디가?', text: text, url: url }).catch(function () { /* 취소 */ }); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text + ' ' + url).then(function () { toast('링크를 복사했어요'); }, function () { toast('복사에 실패했어요'); });
    } else { toast('이 브라우저에서는 공유를 지원하지 않아요'); }
  }

  /* ---------- 결과 카드 이미지 ---------- */
  function clip(ctx, t, maxW) {
    if (ctx.measureText(t).width <= maxW) return t;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }
  function wrapLines(ctx, text, maxW) {
    var lines = [], cur = '';
    for (var i = 0; i < text.length; i++) {
      var t = cur + text[i];
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = text[i]; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function drawCard(kind, it) {
    var W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    var FONT = '"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",system-ui,sans-serif';
    var g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#ff6a47'); g.addColorStop(1, '#5b57d6');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff'; ctx.font = '800 46px ' + FONT; ctx.fillText('🎲 오늘 어디가?', 70, 110);
    ctx.fillStyle = '#ffffff'; rrect(ctx, 60, 150, W - 120, H - 300, 56); ctx.fill();
    var isS = kind === 'subway';
    var name = isS ? stationLabel(it.name) : it.name;
    ctx.fillStyle = '#ff5a3c'; ctx.font = '800 40px ' + FONT;
    ctx.fillText(isS ? '오늘의 지하철역' : '오늘의 여행지', 110, 250);
    ctx.fillStyle = '#1f2540';
    var size = 120; ctx.font = '900 ' + size + 'px ' + FONT;
    while (ctx.measureText(name).width > W - 220 && size > 56) { size -= 6; ctx.font = '900 ' + size + 'px ' + FONT; }
    ctx.fillText(name, 110, 250 + size + 20);
    var y = 250 + size + 80;
    ctx.fillStyle = '#6b7089'; ctx.font = '600 38px ' + FONT;
    var sub = isS ? it.region + ' · ' + it.lines.map(lineLabel).join(' · ')
                  : it.region + ' · ' + it.types.join(' · ') + ' · ' + it.season;
    wrapLines(ctx, sub, W - 220).slice(0, 2).forEach(function (ln) { ctx.fillText(ln, 110, y); y += 52; });
    y += 24;
    it.spots.slice(0, 3).forEach(function (s) {
      ctx.fillStyle = '#fff3ec'; rrect(ctx, 110, y, W - 220, 150, 28); ctx.fill();
      ctx.fillStyle = '#1f2540'; ctx.font = '700 56px ' + FONT;
      ctx.fillText(isS && CAT[s.cat] ? CAT[s.cat].e : '📍', 140, y + 94);
      ctx.font = '800 42px ' + FONT; ctx.fillText(clip(ctx, s.name, W - 220 - 150), 230, y + 66);
      ctx.fillStyle = '#6b7089'; ctx.font = '500 32px ' + FONT; ctx.fillText(clip(ctx, s.desc, W - 220 - 150), 230, y + 114);
      y += 170;
    });
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff'; ctx.font = '600 34px ' + FONT;
    ctx.fillText(location.host + location.pathname.replace(/index\.html$/, ''), W / 2, H - 70);
    return c;
  }
  function download(blob, fname) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    toast('이미지를 저장했어요');
  }
  function shareCard(kind, id) {
    var it = byId(kind, id); if (!it) return;
    var nm = kind === 'subway' ? stationLabel(it.name) : it.name;
    var cv; try { cv = drawCard(kind, it); } catch (e) { toast('이미지를 만들지 못했어요'); return; }
    cv.toBlob(function (blob) {
      if (!blob) { toast('이미지를 만들지 못했어요'); return; }
      var fname = '오늘어디가-' + nm + '.png';
      var file = null; try { file = new File([blob], fname, { type: 'image/png' }); } catch (e) { /* 구형 브라우저 */ }
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: '오늘 어디가?', text: nm }).catch(function (e) {
          if (!e || e.name !== 'AbortError') download(blob, fname);
        });
        return;
      }
      download(blob, fname);
    }, 'image/png');
  }

  /* ---------- 이벤트 위임 ---------- */
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href^="#/"]') : null;
    if (a && !e.defaultPrevented && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      var h = a.getAttribute('href');
      if (h === location.hash) window.scrollTo(0, 0); else go(h);
      return;
    }
    var b = e.target.closest ? e.target.closest('[data-act]') : null; if (!b) return;
    var act = b.getAttribute('data-act'); var kind = b.getAttribute('data-kind') || route.kind; var id = b.getAttribute('data-id');
    if (act === 'roll') spin(kind, null);
    else if (act === 'reroll') spin(kind, id);
    else if (act === 'chip') {
      toggleFilter(route.kind, b.getAttribute('data-g'), b.getAttribute('data-v'));
      if (route.type === 'home') refreshHome(route.kind); else if (route.type === 'list') { paintListFilters(route.kind); paintList(route.kind); }
    } else if (act === 'favonly' || act === 'visitedonly' || act === 'banonly') {
      var lk = act === 'favonly' ? 'fav' : act === 'visitedonly' ? 'visited' : 'ban';
      listState[lk] = !listState[lk]; paintListFilters(route.kind); paintList(route.kind);
    } else if (act === 'onlynew') {
      store.set('new.' + kind, !onlyNew(kind)); if (route.type === 'home') refreshHome(kind);
    } else if (act === 'showban') {
      listState.fav = false; listState.visited = false; listState.ban = true; go('#/' + kind + '/all');
    } else if (act === 'fav') {
      var on = FAV.toggle(kind, id);
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.textContent = on ? '♥ 찜함' : '♡ 찜';
      toast(on ? '찜 목록에 담았어요' : '찜을 해제했어요');
    } else if (act === 'visit') {
      var vOn = VISITED.toggle(kind, id);
      b.classList.toggle('on', vOn); b.setAttribute('aria-pressed', vOn); b.textContent = vOn ? '✓ 가봤어요' : '☐ 가봤어요';
      toast(vOn ? '가본 곳으로 표시했어요' : '가본 표시를 지웠어요');
    } else if (act === 'ban') {
      var bOn = BAN.toggle(kind, id);
      b.classList.toggle('on', bOn); b.setAttribute('aria-pressed', bOn); b.textContent = bOn ? '🚫 제외됨' : '🚫 제외';
      toast(bOn ? '다음 뽑기부터 빼 둘게요' : '다시 뽑기에 포함돼요');
    } else if (act === 'card') shareCard(kind, id);
    else if (act === 'share') share(kind, id);
    else if (act === 'install' && deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () { deferredPrompt = null; paintInstall(); }, function () { /* 무시 */ });
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'q') { listState.q = e.target.value; paintList(route.kind); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target && e.target.id === 'q') e.target.blur();
  });
  backBtn.addEventListener('click', goBack);

  /* ---------- 서비스워커 & 자동 업데이트 ---------- */
  var pendingReload = false;
  if ('serviceWorker' in navigator) {
    var hadController = !!navigator.serviceWorker.controller;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
        var check = function () { reg.update().catch(function () { /* 오프라인 */ }); };
        document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
        setInterval(check, 30 * 60 * 1000);
      }).catch(function () { /* 등록 실패 시에도 앱은 정상 동작 */ });
    });
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; }  // 최초 설치는 알림 없이 통과
      pendingReload = true;
      toast('새 버전이 준비됐어요', '새로고침', function () { location.reload(); }, 12000);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' && pendingReload) location.reload();
    });
  }

  /* ---------- 시작 ---------- */
  var startHash = location.hash && /^#\/(travel|subway)/.test(location.hash) ? location.hash : '#/travel';
  history.replaceState({ d: depth() }, '', location.pathname + location.search + startHash);
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  render(true);
})();
