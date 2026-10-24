/**
 * 桌宠菜单（独立悬浮窗）
 *
 * 最多两列：
 *   一级「桌宠」或二级「分类」只占一列，位置固定在宠物右侧；
 *   三级「动画」出现时，分类列留在宠物右侧，动画列优先放右边；
 *   右边放不下 → 动画列翻到分类列左侧（跨过宠物），并且可以更宽。
 *
 * 整个窗口是独立于宠物的第二个悬浮窗，所以：
 *   - 拖菜单不会带走宠物；
 *   - 菜单窗口只覆盖自己那么大，不会吃掉桌面触摸。
 */
(function () {
  'use strict';

  var N = window.PetMenu || null;

  function readJson(method) {
    if (!N || typeof N[method] !== 'function') return null;
    var raw = null;
    try {
      raw = N[method]();
    } catch (error) {
      return null;
    }
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  function resize(w, h) {
    if (N && N.resize) N.resize(Math.round(w), Math.round(h));
  }
  function moveTo(x, y) {
    if (N && N.moveTo) N.moveTo(Math.round(x), Math.round(y));
  }
  function moveBy(dx, dy) {
    if (N && N.moveBy) N.moveBy(Math.round(dx), Math.round(dy));
  }
  function pick(name) {
    if (N && N.pick) N.pick(name);
  }
  function centerPet() {
    if (N && N.centerPet) N.centerPet();
  }
  function lockPet() {
    if (N && N.lock) N.lock();
  }
  function closeMenu() {
    if (N && N.close) N.close();
  }
  function closePet() {
    if (N && N.closePet) N.closePet();
  }

  var COL_MIN = 96;
  var COL_MAX = 210;
  var ANIM_MIN = 130;
  var ANIM_MAX = 268;
  var GAP = 6;

  var cfg = window.PET_CONFIG;
  var dpr = window.devicePixelRatio || 1;
  var app = document.getElementById('app');

  var screen = { w: 1080, h: 2400 };
  var pet = { x: 0, y: 0, w: 540, h: 304 };

  var step = 'root'; // root | cats | anims
  var catIndex = -1;
  var cats = [];
  var anims = [];
  var moved = false;
  var drag = null;
  var revealed = false;
  var lastOrientation = 'right';
  var lastCatsW = 0;
  var lastAnimsW = 0;

  var rootItems = [
    { label: '余额', action: 'balance' },
    { label: '对话', action: 'chat' },
    { label: '动作', branch: 'cats' },
    { label: '回到中央', action: 'center' },
    { label: '锁定（触摸穿透）', action: 'lock' },
    { label: '关闭悬浮窗', action: 'closePet', danger: true },
  ];

  // ---------------- 数据 ----------------

  function buildCats() {
    var a = cfg.animations;
    var out = [];
    add('待机', a.idle);
    add('转向', a.turn);
    add('拖拽', a.drag);
    add('点击回应', a.clicks);
    add(
      '移动',
      (a.moves.actions || []).map(function (item) {
        return item.name;
      }),
    );
    (a.categories || []).forEach(function (category) {
      add(category.id, category.actions);
    });
    cats = out;

    function add(label, names) {
      if (names && names.length) out.push({ label: label, names: names });
    }
  }

  // ---------------- 渲染 ----------------

  function makeCard(kind) {
    var el = document.createElement('div');
    el.className = 'col';
    var list = document.createElement('div');
    list.className = 'mlist';
    el.appendChild(list);
    app.appendChild(el);
    return { kind: kind, el: el, list: list };
  }

  function fillCard(card, items) {
    card.list.innerHTML = '';
    items.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'mrow' + (item.danger ? ' danger' : '') + (item.on ? ' on' : '');
      var label = document.createElement('span');
      label.className = 'mlabel';
      label.textContent = item.label;
      row.appendChild(label);
      if (item.branch) {
        var arrow = document.createElement('span');
        arrow.className = 'marrow';
        arrow.textContent = '›';
        row.appendChild(arrow);
      }
      row.addEventListener('click', function (event) {
        event.stopPropagation();
        onRow(item);
      });
      card.list.appendChild(row);
    });
  }

  function onRow(item) {
    if (item.action === 'balance') {
      if (N && N.showBalance) N.showBalance();
      return;
    }
    if (item.action === 'chat') {
      openChat();
      return;
    }
    if (item.branch === 'cats') {
      step = 'cats';
      catIndex = -1;
      render();
      return;
    }
    if (item.branch === 'anim') {
      catIndex = item.index;
      anims = cats[item.index].names;
      step = 'anims';
      render();
      return;
    }
    if (item.action === 'play') {
      pick(item.name);
      return;
    }
    if (item.action === 'center') {
      centerPet();
      return;
    }
    if (item.action === 'lock') {
      lockPet();
      return;
    }
    if (item.action === 'closePet') {
      closePet();
    }
  }

  function catItems() {
    return cats.map(function (category, index) {
      return { label: category.label, branch: 'anim', index: index, on: index === catIndex };
    });
  }

  function render() {
    app.innerHTML = '';

    var cards = [];
    if (step === 'root') {
      var rootCard = makeCard('root');
      fillCard(rootCard, rootItems);
      cards.push(rootCard);
    } else if (step === 'cats') {
      var catsCard = makeCard('cats');
      fillCard(catsCard, catItems());
      cards.push(catsCard);
    } else {
      var cCard = makeCard('cats');
      fillCard(cCard, catItems());
      var aCard = makeCard('anims');
      fillCard(
        aCard,
        anims.map(function (name) {
          return { label: name, action: 'play', name: name };
        }),
      );
      cards.push(cCard);
      cards.push(aCard);
    }

    layout(cards);
  }

  // ---------------- 布局 ----------------

  function measureWidth(card, min, max) {
    card.el.style.left = '0px';
    card.el.style.top = '0px';
    card.el.style.width = 'auto';
    card.el.style.height = 'auto';
    var width = Math.ceil(card.el.getBoundingClientRect().width);
    var clamped = Math.max(min, Math.min(max, width));
    card.el.style.width = clamped + 'px';
    return clamped;
  }

  function addHeader(card) {
    var head = document.createElement('div');
    head.className = 'mhead';

    var grip = document.createElement('span');
    grip.className = 'grip';
    grip.textContent = '⠿';

    var title = document.createElement('span');
    title.className = 'mtitle';
    title.textContent = '桌宠';

    var close = document.createElement('button');
    close.className = 'mx';
    close.textContent = '✕';
    close.addEventListener('click', function (event) {
      event.stopPropagation();
      closeMenu();
    });

    head.appendChild(grip);
    head.appendChild(title);
    head.appendChild(close);
    head.addEventListener('touchstart', onDragStart, { passive: false });
    head.addEventListener('touchmove', onDragMove, { passive: false });
    head.addEventListener('touchend', onDragEnd, { passive: true });
    head.addEventListener('mousedown', onDragStart);
    head.addEventListener('mousemove', onDragMove);
    head.addEventListener('mouseup', onDragEnd);

    card.el.insertBefore(head, card.list);
  }

  function layout(cards) {
    var availCss = Math.floor(screen.w / dpr) - 8;
    var capCss = Math.min(560, Math.max(220, Math.round((screen.h / dpr) * 0.72)));

    var widths = [];
    for (var i = 0; i < cards.length; i += 1) {
      var isAnim = cards[i].kind === 'anims';
      widths.push(measureWidth(cards[i], isAnim ? ANIM_MIN : COL_MIN, isAnim ? ANIM_MAX : COL_MAX));
    }

    var orientation = 'right';
    if (cards.length === 2) {
      var totalTwo = widths[0] + GAP + widths[1];
      if (widths[1] + GAP + widths[0] > availCss) {
        // 先缩动画列，再看是否仍放不下
        var overflow = totalTwo - availCss;
        var shrunk = Math.max(ANIM_MIN, widths[1] - overflow);
        cards[1].el.style.width = shrunk + 'px';
        widths[1] = shrunk;
      }
      var petRight = pet.x + pet.w + 8 * dpr;
      if (petRight + (widths[0] + GAP + widths[1]) * dpr > screen.w - 4) {
        orientation = 'left';
      }
    }

    // 摆列：right = [分类][动画]；left = [动画][分类]
    if (cards.length === 2 && orientation === 'left') {
      // DOM 顺序是 [cats, anims]，这里把 anims 放到左边
      cards[1].el.style.left = '0px';
      cards[0].el.style.left = widths[1] + GAP + 'px';
    } else {
      cards[0].el.style.left = '0px';
      if (cards.length > 1) cards[1].el.style.left = widths[0] + GAP + 'px';
    }

    // 表头（拖动把手 + 关闭）加在最左那张卡上
    var leftmost = cards[0];
    if (cards.length === 2 && orientation === 'left') leftmost = cards[1];
    if (!leftmost.el.querySelector('.mhead')) addHeader(leftmost);

    var heights = [];
    cards.forEach(function (card) {
      var height = Math.min(capCss, Math.ceil(card.el.getBoundingClientRect().height));
      card.el.style.height = height + 'px';
      heights.push(height);
    });

    var totalW = widths.reduce(function (sum, w) {
      return sum + w;
    }, 0) + GAP * (cards.length - 1);
    var totalH = Math.max.apply(null, heights);

    lastOrientation = orientation;
    lastCatsW = widths[0];
    lastAnimsW = widths.length > 1 ? widths[1] : 0;

    resize(totalW, totalH);
    if (!moved) place(totalW, totalH);

    if (!revealed) {
      revealed = true;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          app.style.opacity = '1';
        });
      });
    }
  }

  function place(totalW, totalH) {
    var gapPx = 8 * dpr;
    var petRight = pet.x + pet.w + gapPx;
    var x = petRight;

    if (lastOrientation === 'left' && lastAnimsW > 0) {
      // 左列是动画列、右列是分类列：让分类列仍然贴住宠物右侧
      x = petRight - Math.round((lastAnimsW + GAP) * dpr);
    }

    if (x + totalW * dpr > screen.w - 4) {
      x = Math.max(4, screen.w - totalW * dpr - 4);
    }
    if (x < 4) x = 4;

    var y = pet.y + Math.round((pet.h - totalH * dpr) / 2);
    y = Math.max(4, Math.min(screen.h - totalH * dpr - 4, y));

    moveTo(x, y);
  }

  // ---------------- 拖动 ----------------

  function point(event) {
    var touch = event.touches && event.touches.length ? event.touches[0] : event;
    var x = typeof touch.screenX === 'number' ? touch.screenX : 0;
    var y = typeof touch.screenY === 'number' ? touch.screenY : 0;
    if (x === 0 && y === 0) {
      x = touch.clientX || 0;
      y = touch.clientY || 0;
    }
    return { x: x, y: y };
  }

  function onDragStart(event) {
    // 表头的 ✕ 也在拖动区里：touchstart 上的 preventDefault 会把后续 click 吃掉，
    // 所以从按钮上开始的触摸不当作拖动，让按钮自己的 click 正常触发。
    var target = event.target;
    if (target && target.closest && target.closest('.mx')) return;

    var p = point(event);
    drag = { x: p.x, y: p.y };
    moved = true;
    if (event.cancelable) event.preventDefault();
  }

  function onDragMove(event) {
    if (!drag) return;
    var p = point(event);
    var dx = Math.round((p.x - drag.x) * dpr);
    var dy = Math.round((p.y - drag.y) * dpr);
    drag.x = p.x;
    drag.y = p.y;
    if (dx !== 0 || dy !== 0) moveBy(dx, dy);
    if (event.cancelable) event.preventDefault();
  }

  function onDragEnd() {
    drag = null;
  }

  // ---------------- 对话输入（只有输入框） ----------------

  var sending = false;
  var focusAt = 0;

  function openChat() {
    var chat = document.getElementById('chat');
    var input = document.getElementById('chatInput');
    app.style.display = 'none';
    chat.hidden = false;

    var boxW = 230;
    var boxH = 48;
    var tail = 8;
    var gap = 12;
    var screenW = screen.w / dpr;
    var screenH = screen.h / dpr;
    var petTop = pet.y / dpr;
    var petBottom = (pet.y + pet.h) / dpr;
    var totalH = boxH + tail;

    // 宠物头顶放得下就在上方（尾巴朝下），否则翻到脚下（尾巴朝上）
    var above = petTop >= totalH + gap + 16;
    var y = above ? petTop - totalH - gap : petBottom + gap;

    // 翻到脚下时不要掉进键盘区；实在不行退回上方
    if (!above && y + totalH > screenH * 0.45) {
      above = true;
      y = Math.max(12, petTop - totalH - gap);
    }
    y = Math.max(4, Math.min(screenH - totalH - 4, y));

    chat.className = above ? 'tail-down' : 'tail-up';

    var centerX = (pet.x + pet.w / 2) / dpr;
    var x = Math.max(4, Math.min(screenW - boxW - 4, centerX - boxW / 2));

    resize(boxW, totalH);
    moveTo(Math.round(x * dpr), Math.round(y * dpr));

    if (N && N.setFocusable) N.setFocusable(true);
    setTimeout(function () {
      try {
        input.focus();
      } catch (error) {
        /* ignore */
      }
    }, 150);
  }

  function sendChat() {
    var input = document.getElementById('chatInput');
    var text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    input.value = '';
    if (N && N.setFocusable) N.setFocusable(false);
    if (N && N.chatSend) N.chatSend(text);
  }

  function bootChat() {
    var input = document.getElementById('chatInput');
    input.addEventListener('focus', function () {
      focusAt = Date.now();
      sending = false;
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        sendChat();
      }
    });
    // 键盘收起（失焦）= 取消；刚弹出就失焦的情况忽略，避免窗口一闪而过
    input.addEventListener('blur', function () {
      if (Date.now() - focusAt < 400) return;
      setTimeout(function () {
        if (!sending && N && N.close) N.close();
      }, 250);
    });
  }

  // ---------------- 启动 ----------------

  function boot() {
    var info = readJson('getScreenInfo');
    if (info && info.width) screen = { w: info.width, h: info.height };
    var rect = readJson('getPetRect');
    if (rect && rect.w) pet = rect;

    if (!cfg || !cfg.animations) {
      app.textContent = '配置缺失';
      return;
    }
    buildCats();
    bootChat();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
