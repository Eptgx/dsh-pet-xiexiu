/**
 * 悬浮桌宠 · 宠物窗页面
 *
 * 只负责宠物本体：动画链、点击、拖拽甩抛、位置记忆。
 * 菜单是另一个独立悬浮窗（menu.html），这里只通过 PetNative.openMenu() 把它叫出来；
 * 菜单选中动作后，服务端会调 window.__petPlay(name) 回到这个页面播放。
 *
 * 坐标约定：原生侧（窗口 x/y/w/h）用物理像素；页面用 CSS 像素，换算乘/除 devicePixelRatio。
 * 拖拽采样用 screenX/screenY（绝对坐标）——用 clientX 会因窗口跟着手指移动而恒为 0。
 */
(function () {
  'use strict';

  var S = window.PetShared;
  var native = window.PetNative || null;

  var LONG_PRESS_MS = 480;
  var TAP_SLOP = 6;
  var SQ_MS = (S && S.SQ_DURATION_MS) || 220;

  // 素材 640×360，角色只占中间约 37.5% 宽。裁到 x120..520 / y20..340（400×320），
  // 让角色填满窗口；这是"宠物看起来太小"的根因，换档位治不了。
  var CROP = { x: 120, y: 20, w: 400, h: 320 };

  // 说话时循环播放的片段（现有素材里嘴部一直在动的那段）
  var TALK_CLIP = '悠闲哼歌';
  var talking = false;

  var stage, sprite, vids, dbgEl;

  var cfg = null;
  var dpr = window.devicePixelRatio || 1;
  var screenSize = { w: 0, h: 0 };
  var win = { x: 0, y: 0, w: 540, h: 304 };
  var petSize = { w: 540, h: 304 };
  var settings = { sizeDp: 180, fixed: false, marginDp: 12 };
  var sizeCss = 180;
  var active = 0;
  var current = '';
  var facing = 'left';
  var busy = null; // null | 'drag' | 'walk' | 'flight'
  var pending = false;
  var touch = null;
  var trail = [];
  var longTimer = 0;
  var longFired = false;
  var walkToken = 0;
  var flightToken = 0;
  var squashToken = 0;

  // ---------------- 原生桥 ----------------

  function readJson(method) {
    if (!native || typeof native[method] !== 'function') return null;
    var raw = null;
    try {
      raw = native[method]();
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

  function moveTo(x, y) {
    if (native && native.moveTo) native.moveTo(x, y);
  }
  function moveBy(dx, dy) {
    if (native && native.moveBy) native.moveBy(dx, dy);
  }
  function closePet() {
    if (native && native.close) native.close();
  }
  function openNativeMenu() {
    if (native && native.openMenu) native.openMenu();
  }
  function isMenuOpen() {
    try {
      return !!(native && native.isMenuOpen && native.isMenuOpen());
    } catch (error) {
      return false;
    }
  }
  function closeNativeMenu() {
    if (native && native.closeMenu) native.closeMenu();
  }

  // ---------------- 小工具 ----------------

  function $(id) {
    return document.getElementById(id);
  }

  function hud(extra) {
    if (!dbgEl) return;
    dbgEl.textContent =
      'nat:' + (native ? 'y' : 'n') +
      ' dpr:' + dpr.toFixed(2) +
      '\nscr:' + screenSize.w + 'x' + screenSize.h +
      '\nwin:' + Math.round(win.x) + ',' + Math.round(win.y) + ' ' + petSize.w + 'x' + petSize.h +
      (extra ? '\n' + extra : '');
  }

  function merge() {
    var out = {};
    for (var i = 0; i < arguments.length; i += 1) {
      var src = arguments[i];
      if (!src) continue;
      for (var key in src) {
        if (Object.prototype.hasOwnProperty.call(src, key)) out[key] = src[key];
      }
    }
    return out;
  }

  function whenMeta(video, cb) {
    if (!video) return;
    if (video.readyState >= 1) {
      cb();
      return;
    }
    var handler = function () {
      video.removeEventListener('loadedmetadata', handler);
      cb();
    };
    video.addEventListener('loadedmetadata', handler);
  }

  function applyTransform() {
    if (!sprite) return;
    stage.style.transform = 'scaleX(' + (facing === 'right' ? -1 : 1) + ')';
  }

  function flipFacing() {
    facing = facing === 'left' ? 'right' : 'left';
    applyTransform();
  }

  function savePos() {
    try {
      localStorage.setItem('pet.pos', JSON.stringify({ x: Math.round(win.x), y: Math.round(win.y) }));
    } catch (error) {
      /* file:// 下可能禁用 localStorage */
    }
  }

  function restorePos() {
    try {
      var raw = localStorage.getItem('pet.pos');
      if (!raw) return;
      var pos = JSON.parse(raw);
      if (typeof pos.x === 'number' && typeof pos.y === 'number') {
        win.x = pos.x;
        win.y = pos.y;
        clampPos();
        moveTo(Math.round(win.x), Math.round(win.y));
      }
    } catch (error) {
      /* ignore */
    }
  }

  function bounds() {
    // 四周留 margin：宠物身体永远不贴屏幕边缘（拖、甩、走都受它约束）
    var margin = Math.round((settings.marginDp || 12) * dpr);
    var size = petSize.w;
    var height = Math.round(size * CROP.h / CROP.w);
    var sideAllow = size * 0.3125;
    return {
      minX: margin - sideAllow,
      maxX: screenSize.w - margin - size + sideAllow,
      minY: margin,
      maxY: screenSize.h - margin - height,
    };
  }

  /** 按窗口宽度重排舞台：窗口 = 裁切框，视频放大后偏移出去。 */
  function applyStageSize() {
    var width = Math.round(win.w / dpr);
    sizeCss = width;
    var height = Math.round(width * CROP.h / CROP.w);
    stage.style.width = width + 'px';
    stage.style.height = height + 'px';
  }

  /**
   * 每段动画的几何：默认按裁切框放大；内容超出裁切框（文字气泡、风筝、烟花…）时，
   * 按它的真实包围盒缩到"完整可见"，脚底线仍贴着舞台底部。
   */
  function geometryFor(name) {
    var stageW = sizeCss;
    var stageH = Math.round(stageW * CROP.h / CROP.w);
    var base = stageW / CROP.w;
    var fallback = { w: 640 * base, h: 360 * base, x: -CROP.x * base, y: -CROP.y * base };

    var bounds = window.PET_BOUNDS || {};
    var box = bounds[name];
    if (!box || box.length !== 4) return fallback;

    var inside =
      box[0] >= CROP.x &&
      box[1] >= CROP.y &&
      box[2] <= CROP.x + CROP.w &&
      box[3] <= CROP.y + CROP.h;
    if (inside) return fallback;

    var bw = Math.max(1, box[2] - box[0]);
    var bh = Math.max(1, box[3] - box[1]);
    var scale = Math.min(stageW / bw, stageH / bh, base);
    return {
      w: 640 * scale,
      h: 360 * scale,
      x: stageW / 2 - ((box[0] + box[2]) / 2) * scale,
      y: stageH - box[3] * scale,
    };
  }

  /** 把某段动画的几何应用到视频元素上（窗口尺寸变化后要重新调用一遍）。 */
  function applyGeometry(el, name) {
    if (!el) return;
    var geo = geometryFor(name);
    el.style.left = geo.x + 'px';
    el.style.top = geo.y + 'px';
    el.style.width = geo.w + 'px';
    el.style.height = geo.h + 'px';
  }

  function clampPos() {
    var b = bounds();
    win.x = Math.max(b.minX, Math.min(b.maxX, win.x));
    win.y = Math.max(b.minY, Math.min(b.maxY, win.y));
  }

  function applySettings(data) {
    if (!data) return;
    settings = {
      sizeDp: data.sizeDp || settings.sizeDp,
      fixed: !!data.fixed,
      marginDp: data.marginDp || settings.marginDp,
    };
  }

  // ---------------- 动画 ----------------

  function playAnim(name, once, loop) {
    if (!cfg || !name) return null;
    var id = cfg.files[name];
    if (!id) return null;

    var next = vids[1 - active];
    var prev = vids[active];
    var el = next;

    current = name;
    applyGeometry(el, name);
    el.loop = !!loop;
    el.src = 'pet/anim/' + id + '.webm';
    el.load();
    el.onloadeddata = function () {
      el.onloadeddata = null;
      try {
        el.play();
      } catch (error) {
        /* 忽略自动播放失败 */
      }
      el.classList.add('front');
      prev.classList.remove('front');
      active = 1 - active;
    };
    return el;
  }

  function onEnded(video) {
    if (talking) return;
    if (!video.classList.contains('front')) return;
    if (busy) {
      pending = true;
      return;
    }
    nextAnim();
  }

  function flushPending() {
    if (!pending) return;
    pending = false;
    nextAnim();
  }

  function nextAnim() {
    if (!cfg || talking) return;
    var kind = S.rollKind(Math.random(), cfg.animationWeights || {}, { fixed: settings.fixed });
    if (kind === 'idle') {
      playAnim(S.pick(cfg.animations.idle, current));
      return;
    }
    if (kind === 'turn') {
      flipFacing();
      playAnim(S.pick(cfg.animations.turn, current));
      return;
    }
    if (kind === 'move') {
      startWalk(null);
      return;
    }
    var act = S.pickCategoryAction(
      cfg.animations.categories || [],
      cfg.animations.idle,
      facing,
      current,
    );
    playAnim(act.name);
  }

  // ---------------- AI 动作标签 ----------------

  var ACTION_CLASS = {
    跳: 'anim-jump',
    哭: 'anim-shake',
    生气: 'anim-shake',
    笑: 'anim-scale',
    吃: 'anim-scale',
    撒娇: 'anim-sway',
    委屈: 'anim-pout',
  };
  // 说话时也能播的"小动作"，其余大动作等说完再补
  var SMALL_ACTIONS = { 笑: true, 吃: true, 撒娇: true, 委屈: true };
  var ACTION_CLASSES = ['anim-jump', 'anim-shake', 'anim-scale', 'anim-sway', 'anim-pout'];

  var actionTimer = 0;
  var pendingAction = null;

  /** 这段动画是不是"刚好装满舞台"的宽动作：是的话跳/放大一定会被裁 */
  function isWideClip(name) {
    var box = (window.PET_BOUNDS || {})[name];
    if (!box || box.length !== 4) return false;
    return !(
      box[0] >= CROP.x &&
      box[1] >= CROP.y &&
      box[2] <= CROP.x + CROP.w &&
      box[3] <= CROP.y + CROP.h
    );
  }

  function clearActionClasses() {
    ACTION_CLASSES.forEach(function (cls) {
      sprite.classList.remove(cls);
    });
    clearTimeout(actionTimer);
  }

  function applyAction(action) {
    var cls = ACTION_CLASS[action];
    if (!cls) return;

    // 拖拽 / 飞行中不播；宽动作跳过"跳"和"放大"，否则会被舞台裁掉
    if (busy === 'drag' || busy === 'flight') return;
    if (isWideClip(current) && (cls === 'anim-jump' || cls === 'anim-scale')) return;

    // 大动作等说完再补
    if (talking && !SMALL_ACTIONS[action]) {
      pendingAction = action;
      return;
    }

    clearActionClasses();
    void sprite.offsetWidth; // 强制重排：连续两次同一动作也能重新播
    sprite.classList.add(cls);

    // animationend 没来时的兜底，避免卡在半空
    actionTimer = setTimeout(function () {
      sprite.classList.remove(cls);
    }, 1400);
  }

  /** 动画结束立刻清 class（必须在 boot 里 sprite 就绪后绑定，不能写在顶层）。 */
  function bindActionEvents() {
    sprite.addEventListener('animationend', function (event) {
      if (event.target !== sprite) return;
      clearActionClasses();
    });
  }

  /** 开始"说话"：从说话池随机抽一段循环播放，期间不抽随机动作、不走动。 */
  function startTalk() {
    if (!cfg || talking) return;
    var pool = (cfg.talkAnims && cfg.talkAnims.length ? cfg.talkAnims : [TALK_CLIP]).filter(function (name) {
      return !!cfg.files[name];
    });
    if (!pool.length) return;
    talking = true;
    cancelFlight();
    cancelWalk();
    playAnim(pool[Math.floor(Math.random() * pool.length)], false, true);
  }

  /** 说完：解除循环，回到待机链。 */
  function stopTalk() {
    if (!talking) return;
    talking = false;
    vids.forEach(function (video) {
      video.loop = false;
    });
    if (cfg) playAnim(S.pick(cfg.animations.idle, current));
    // 说话期间攒下的大动作，说完补播
    if (pendingAction) {
      var next = pendingAction;
      pendingAction = null;
      applyAction(next);
    }
  }

  function squash(amount) {
    var token = ++squashToken;
    var start = performance.now();
    var dir = facing === 'right' ? -1 : 1;
    function frame(now) {
      if (token !== squashToken) return;
      var u = Math.min(1, (now - start) / SQ_MS);
      var sy = S.squashScale(u, amount);
      stage.style.transform = 'scaleX(' + dir + ') scaleY(' + sy + ')';
      if (u < 1) requestAnimationFrame(frame);
      else applyTransform();
    }
    requestAnimationFrame(frame);
  }

  // ---------------- 移动 / 拖拽 / 抛掷 ----------------

  function startWalk(entry) {
    if (!cfg || talking) return;
    cancelFlight();
    var actions = (cfg.animations.moves && cfg.animations.moves.actions) || [];
    var item = entry || actions[Math.floor(Math.random() * actions.length)];
    if (!item) {
      playAnim(S.pick(cfg.animations.idle, current));
      return;
    }

    var params = merge(
      { minDist: 60, maxDist: 240, margin: 20, leadSec: 2, tailSec: 2 },
      cfg.animations.moves.default,
      item.params,
    );
    var video = playAnim(item.name, true);
    if (!video) return;

    busy = 'walk';
    var token = ++walkToken;

    whenMeta(video, function () {
      var duration = isFinite(video.duration) && video.duration > 0 ? video.duration : 4;
      var lead = Math.min(params.leadSec, duration * 0.35);
      var tail = Math.min(params.tailSec, duration * 0.35);
      var moveSec = Math.max(0.3, duration - lead - tail);

      setTimeout(function () {
        if (token !== walkToken) return;
        var distCss = S.randomBetween(params.minDist, params.maxDist) * (sizeCss / S.PET_REF_WIDTH);
        var dir = facing === 'right' ? 1 : -1;
        var b = bounds();
        var from = win.x;
        var to = Math.max(b.minX, Math.min(b.maxX, from + dir * distCss * dpr));
        var start = performance.now();

        function frame(now) {
          if (token !== walkToken) return;
          var u = Math.min(1, (now - start) / (moveSec * 1000));
          var eased = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
          win.x = from + (to - from) * eased;
          moveTo(Math.round(win.x), Math.round(win.y));
          if (u < 1) {
            requestAnimationFrame(frame);
          } else {
            busy = null;
            savePos();
            flushPending();
          }
        }
        requestAnimationFrame(frame);
      }, lead * 1000);
    });
  }

  function cancelWalk() {
    walkToken += 1;
    if (busy === 'walk') busy = null;
  }

  function startFlight(vx, vy) {
    var token = ++flightToken;
    var b = bounds();
    var state = { x: win.x, y: win.y, vx: vx, vy: vy };
    busy = 'flight';
    playAnim((cfg.animations.drag && cfg.animations.drag[0]) || '', true);

    var last = performance.now();
    function frame(now) {
      if (token !== flightToken) return;
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      var beforeVy = state.vy;
      var result = S.throwStep(state, dt, b, cfg.physics);
      state = { x: result.x, y: result.y, vx: result.vx, vy: result.vy };
      win.x = state.x;
      win.y = state.y;
      moveTo(Math.round(state.x), Math.round(state.y));
      if (result.atRest) {
        squash(S.landingSquash(Math.abs(beforeVy)));
        busy = null;
        savePos();
        flushPending();
        return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function cancelFlight() {
    flightToken += 1;
    if (busy === 'flight') busy = null;
  }

  function pointOf(t) {
    var x = typeof t.screenX === 'number' ? t.screenX : 0;
    var y = typeof t.screenY === 'number' ? t.screenY : 0;
    if (x === 0 && y === 0) {
      x = t.clientX || 0;
      y = t.clientY || 0;
    }
    return { x: x, y: y };
  }

  function beginDrag() {
    if (!touch) return;
    if (talking) stopTalk();
    clearActionClasses();
    pendingAction = null;
    touch.dragging = true;
    clearTimeout(longTimer);
    cancelFlight();
    cancelWalk();
    busy = 'drag';
    if (cfg.animations.drag && cfg.animations.drag.length) {
      playAnim(cfg.animations.drag[0], true);
    }
  }

  function onTouchStart(event) {
    // 菜单开着时，点宠物 = 关菜单（菜单自己盖不到的地方也能关）
    if (isMenuOpen()) {
      closeNativeMenu();
      return;
    }

    var t = event.touches ? event.touches[0] : event;
    if (!t) return;
    var p = pointOf(t);
    touch = { sx: p.x, sy: p.y, lx: p.x, ly: p.y, moved: false, dragging: false };
    trail = [{ t: performance.now(), x: p.x * dpr, y: p.y * dpr }];
    longFired = false;
    clearTimeout(longTimer);
    longTimer = setTimeout(function () {
      if (!touch || touch.dragging) return;
      longFired = true;
      openNativeMenu();
    }, LONG_PRESS_MS);
    if (event.cancelable) event.preventDefault();
  }

  function onTouchMove(event) {
    if (!touch) return;
    var t = event.touches ? event.touches[0] : event;
    if (!t) return;
    var p = pointOf(t);

    if (!touch.dragging && !longFired) {
      if (Math.abs(p.x - touch.sx) + Math.abs(p.y - touch.sy) > TAP_SLOP) beginDrag();
    }

    if (touch.dragging) {
      var dx = p.x - touch.lx;
      var dy = p.y - touch.ly;
      touch.lx = p.x;
      touch.ly = p.y;
      if (dx !== 0 || dy !== 0) {
        win.x += dx * dpr;
        win.y += dy * dpr;
        clampPos();
        moveTo(Math.round(win.x), Math.round(win.y));
        trail.push({ t: performance.now(), x: p.x * dpr, y: p.y * dpr });
        trail = S.trimTrail(trail, performance.now());
      }
    }
    if (event.cancelable) event.preventDefault();
  }

  function onTouchEnd() {
    if (!touch) return;
    clearTimeout(longTimer);

    if (longFired) {
      longFired = false;
      touch = null;
      return;
    }

    var dragging = touch.dragging;
    touch = null;

    if (dragging) {
      busy = null;
      var velocity = S.estimateReleaseVelocity(trail, performance.now(), cfg.physics);
      if (velocity && (velocity.vx !== 0 || velocity.vy !== 0)) startFlight(velocity.vx, velocity.vy);
      else {
        playAnim(S.pick(cfg.animations.idle, current));
        savePos();
        flushPending();
      }
      return;
    }

    if (busy || talking) return;
    squash(S.SQ_SQUASH);
    playAnim(S.pick(cfg.animations.clicks, current), true);
  }

  // ---------------- 给菜单窗调的接口 ----------------

  function playChosen(name) {
    if (!cfg || !name) return;
    var moveItem = null;
    (cfg.animations.moves.actions || []).forEach(function (item) {
      if (item.name === name) moveItem = item;
    });
    if ((cfg.animations.turn || []).indexOf(name) >= 0) flipFacing();
    if (moveItem) startWalk(moveItem);
    else playAnim(name, true);
  }

  function centerPet() {
    win.x = Math.round((screenSize.w - petSize.w) / 2);
    win.y = Math.round((screenSize.h - petSize.h) / 2);
    moveTo(win.x, win.y);
    savePos();
  }

  // ---------------- 启动 ----------------

  function start(data) {
    cfg = data;
    window.__petPlay = function (name) {
      playChosen(name);
    };
    window.__petCenter = function () {
      centerPet();
    };
    var first = (cfg.animations.idle || [])[0];
    if (first) playAnim(first, true);
  }

  function boot() {
    stage = $('stage');
    sprite = $('sprite');
    vids = [$('vid0'), $('vid1')];
    dbgEl = $('dbg');
    bindActionEvents();

    window.onerror = function () {
      hud('ERR');
    };

    var info = readJson('getScreenInfo');
    if (info && info.width && info.height) {
      screenSize = { w: info.width, h: info.height };
    } else {
      screenSize = { w: Math.round(window.innerWidth * dpr), h: Math.round(window.innerHeight * dpr) };
    }

    var rect = readJson('getWindowRect');
    if (rect && rect.w > 0) {
      win = rect;
      petSize = { w: rect.w, h: rect.h };
    } else {
      win = { x: 0, y: Math.round(screenSize.h / 3), w: Math.round(180 * dpr), h: Math.round(180 * 0.8 * dpr) };
      petSize = { w: win.w, h: win.h };
    }

    applyStageSize();

    applySettings(readJson('getPetSettings'));

    window.__petSettingsChanged = function () {
      var next = readJson('getWindowRect');
      if (next && next.w > 0) {
        win = next;
        petSize = { w: next.w, h: next.h };
        applyStageSize();
      }
      applySettings(readJson('getPetSettings'));
      // 窗口尺寸变了，正在播的那段视频要按新尺寸重算几何，否则会等下一段动画才更新
      vids.forEach(function (video) {
        if (video.classList.contains('front') && current) {
          applyGeometry(video, current);
        }
      });
      clampPos();
      moveTo(Math.round(win.x), Math.round(win.y));
      savePos();
    };

    // 服务在 TTS 的 onStart / onDone 时调用，用来让口型跟着说话
    window.__petTalkStart = startTalk;
    window.__petTalkStop = stopTalk;
    // AI 回复里的动作标签：服务解析后在这里触发
    window.__petApplyAction = applyAction;

    applyTransform();
    restorePos();

    vids.forEach(function (video) {
      video.addEventListener('ended', function () {
        onEnded(video);
      });
    });

    document.addEventListener('touchstart', onTouchStart, { passive: false });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('touchcancel', onTouchEnd, { passive: true });
    document.addEventListener('mousedown', onTouchStart);
    document.addEventListener('mousemove', onTouchMove);
    document.addEventListener('mouseup', onTouchEnd);
    document.addEventListener('contextmenu', function (event) {
      event.preventDefault();
    });

    // 配置用 <script src="pet/config.js"> 注入：file:// 页面里 fetch 会被 CORS 拦掉
    if (window.PET_CONFIG) {
      start(window.PET_CONFIG);
      return;
    }
    fetch('pet/config.json')
      .then(function (response) {
        return response.json();
      })
      .then(start)
      .catch(function () {
        /* 配置缺失时保持透明空窗 */
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();


