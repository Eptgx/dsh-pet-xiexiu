import fs from 'fs-extra';
import path from 'path';

export const DEMO2APK_RUNTIME_SCRIPT_FILENAME = 'demo2apk-runtime.js';

/**
 * Parse a CSS colour into `#RRGGBB` for the native system bar bridge.
 *
 * Unlike the build-time helper this rejects fully transparent colours: a page
 * keeps `rgba(0, 0, 0, 0)` on `body` far more often than it keeps a real
 * background there, and forwarding that would blank out the system bars.
 */
export function normalizeThemeColor(input: string | null | undefined): string | undefined {
  if (!input) return undefined;

  const value = input.trim().toLowerCase();
  if (!value || value === 'transparent') return undefined;

  let match = value.match(/^#([0-9a-f]{3})$/);
  if (match) {
    const rgb = match[1];
    return `#${rgb[0]}${rgb[0]}${rgb[1]}${rgb[1]}${rgb[2]}${rgb[2]}`;
  }

  match = value.match(/^#([0-9a-f]{6})$/);
  if (match) return `#${match[1]}`;

  match = value.match(/^#([0-9a-f]{8})$/);
  if (match) {
    if (match[1].slice(6, 8) === '00') return undefined;
    return `#${match[1].slice(0, 6)}`;
  }

  match = value.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([0-9.]+)\s*)?\)$/);
  if (match) {
    const alpha = match[4];
    if (alpha !== undefined && parseFloat(alpha) === 0) return undefined;
    const toHex = (n: string) => Math.min(255, parseInt(n, 10)).toString(16).padStart(2, '0');
    return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`;
  }

  return undefined;
}

const SYSTEM_BAR_SYNC_SCRIPT = `  // Keeps the Android system bars in step with the page background so in-app
  // theme switches are reflected right away, and publishes the real system bar
  // sizes as --demo2apk-safe-top / --demo2apk-safe-bottom for pages whose
  // env(safe-area-inset-*) resolves to 0 under Android WebView. Silent no-op
  // without the native bridge (e.g. the Cordova build), and native failures are
  // mirrored into the page console.
  var demo2apkLastBarColor = null;
  var demo2apkLastInsetTop = -1;
  var demo2apkLastInsetBottom = -1;
  var demo2apkLastDiagnostics = '';
  var demo2apkSyncScheduled = false;

  var normalizeBarColor = function (raw) {
    if (!raw) return null;
    var value = String(raw).trim().toLowerCase();
    if (!value || value === 'transparent') return null;

    var match = value.match(/^#([0-9a-f]{3})$/);
    if (match) {
      var short = match[1];
      return '#' + short[0] + short[0] + short[1] + short[1] + short[2] + short[2];
    }

    match = value.match(/^#([0-9a-f]{6})$/);
    if (match) return '#' + match[1];

    match = value.match(/^#([0-9a-f]{8})$/);
    if (match) return match[1].slice(6, 8) === '00' ? null : '#' + match[1].slice(0, 6);

    match = value.match(/^rgba?\\(\\s*([0-9]{1,3})\\s*,\\s*([0-9]{1,3})\\s*,\\s*([0-9]{1,3})\\s*(?:,\\s*([0-9.]+)\\s*)?\\)$/);
    if (match) {
      if (match[4] !== undefined && parseFloat(match[4]) === 0) return null;
      var toHex = function (part) {
        var n = Math.min(255, parseInt(part, 10));
        var hex = n.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      };
      return '#' + toHex(match[1]) + toHex(match[2]) + toHex(match[3]);
    }

    return null;
  };

  var hasNativeSystemBar = function () {
    return !!window.Demo2APKSystemBar && typeof window.Demo2APKSystemBar.setColor === 'function';
  };

  var readBarColor = function () {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      var fromMeta = normalizeBarColor(meta.getAttribute('content'));
      if (fromMeta) return fromMeta;
    }

    if (!window.getComputedStyle) return null;

    var nodes = [document.documentElement, document.body, document.getElementById('root')];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node) continue;
      var fromStyle = normalizeBarColor(window.getComputedStyle(node).backgroundColor);
      if (fromStyle) return fromStyle;
    }

    return null;
  };

  var applyBarColor = function (color) {
    var hex = normalizeBarColor(color);
    if (!hex || !hasNativeSystemBar()) return false;
    if (hex === demo2apkLastBarColor) return true;

    try {
      window.Demo2APKSystemBar.setColor(hex);
      demo2apkLastBarColor = hex;
      return true;
    } catch (e) {
      return false;
    }
  };

  var syncBarColor = function () {
    applyBarColor(readBarColor());
  };

  // Android WebView resolves env(safe-area-inset-*) from display cutouts only,
  // so on most phones it stays 0 even while the status bar overlays the page.
  // The native side reports the real insets; publish them as CSS variables.
  var syncSafeArea = function () {
    var bridge = window.Demo2APKSystemBar;
    if (!bridge || typeof bridge.getSafeAreaInsets !== 'function') return false;

    try {
      var raw = bridge.getSafeAreaInsets();
      if (!raw) return false;

      var parsed = JSON.parse(raw);
      var top = Math.max(0, parseInt(parsed.top, 10) || 0);
      var bottom = Math.max(0, parseInt(parsed.bottom, 10) || 0);
      var rootEl = document.documentElement;
      if (!rootEl) return false;

      if (top === demo2apkLastInsetTop && bottom === demo2apkLastInsetBottom) return true;

      rootEl.style.setProperty('--demo2apk-safe-top', top + 'px');
      rootEl.style.setProperty('--demo2apk-safe-bottom', bottom + 'px');
      demo2apkLastInsetTop = top;
      demo2apkLastInsetBottom = bottom;
      return true;
    } catch (e) {
      return false;
    }
  };

  // Mirrors the native failures into the page console, so a broken device can
  // be diagnosed from remote debugging without adb.
  var reportDiagnostics = function () {
    var bridge = window.Demo2APKSystemBar;
    if (!bridge || typeof bridge.getDiagnostics !== 'function') return false;

    try {
      var raw = bridge.getDiagnostics();
      if (!raw) return false;

      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.length) return false;

      var signature = parsed.length + ':' + parsed[parsed.length - 1];
      if (signature === demo2apkLastDiagnostics) return true;
      demo2apkLastDiagnostics = signature;

      for (var i = 0; i < parsed.length; i++) {
        if (window.console && typeof window.console.warn === 'function') {
          window.console.warn('[Demo2APK] ' + parsed[i]);
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  };

  var syncSystemBars = function () {
    syncBarColor();
    syncSafeArea();
    reportDiagnostics();
  };

  var scheduleBarSync = function () {
    if (demo2apkSyncScheduled) return;
    demo2apkSyncScheduled = true;

    var run = function () {
      demo2apkSyncScheduled = false;
      syncSystemBars();
    };

    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run);
    else setTimeout(run, 16);
  };

  var initSystemBarSync = function () {
    window.Demo2APK = {
      setSystemBarColor: function (color) { applyBarColor(color); },
      refreshSystemBar: function () { syncSystemBars(); },
      refreshSafeArea: function () { syncSafeArea(); }
    };

    syncSystemBars();

    try {
      var observer = new MutationObserver(scheduleBarSync);
      var themeAttributes = { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] };
      if (document.documentElement) observer.observe(document.documentElement, themeAttributes);
      if (document.body) observer.observe(document.body, themeAttributes);
      if (document.head) {
        observer.observe(document.head, { attributes: true, attributeFilter: ['content'], childList: true, subtree: true });
      }
    } catch (e) {
      // MutationObserver unavailable: the listeners below still cover switches.
    }

    if (window.matchMedia) {
      try {
        var query = window.matchMedia('(prefers-color-scheme: dark)');
        if (typeof query.addEventListener === 'function') query.addEventListener('change', scheduleBarSync);
        else if (typeof query.addListener === 'function') query.addListener(scheduleBarSync);
      } catch (e) {
        // Ignore: colour scheme tracking is best-effort.
      }
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scheduleBarSync();
    });
    window.addEventListener('focus', scheduleBarSync);
    window.addEventListener('resize', scheduleBarSync);
    window.addEventListener('orientationchange', scheduleBarSync);

    // The native bridge is registered after the page starts loading, so poll
    // briefly until it appears, then stop (roughly six seconds at most).
    if (!hasNativeSystemBar()) {
      var attempts = 0;
      var poll = function () {
        attempts += 1;
        if (hasNativeSystemBar()) {
          syncSystemBars();
          return;
        }
        if (attempts < 30) setTimeout(poll, 200);
      };
      setTimeout(poll, 200);
    }
  };

`;

export function buildSystemBarSyncScript(): string {
  return SYSTEM_BAR_SYNC_SCRIPT;
}

export const DEMO2APK_RUNTIME_SCRIPT_CONTENT = `(() => {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isHybrid = typeof window.cordova !== 'undefined' || typeof window.Capacitor !== 'undefined';
  if (!isAndroid || !isHybrid) return;

  const normalizeAccept = (accept) => {
    const parts = accept
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    const lower = parts.map((p) => p.toLowerCase());
    const hasProblematicMime = lower.some((p) => {
      if (p === 'application/json' || p === 'text/json') return true;
      if (p.startsWith('font/')) return true;
      if (p.includes('opentype')) return true;
      if (p.includes('x-font')) return true;
      return false;
    });
    if (hasProblematicMime) return '*/*';

    const hasExt = parts.some((p) => p.startsWith('.'));
    if (!hasExt) return null;

    const mimeParts = parts.filter((p) => p.includes('/') || p === '*/*');
    if (mimeParts.length > 0) return mimeParts.join(',');

    return '*/*';
  };

  const patchFileInput = (input) => {
    if (input.dataset && input.dataset.demo2apkAcceptPatched === '1') return;
    if (input.dataset) input.dataset.demo2apkAcceptPatched = '1';

    const accept = input.getAttribute('accept');
    if (!accept) return;

    const normalized = normalizeAccept(accept);
    if (!normalized) return;

    if (normalized !== accept) {
      input.setAttribute('accept', normalized);
    }
  };

  const patchFileInputs = (root) => {
    if (!root || !root.querySelectorAll) return;
    const inputs = root.querySelectorAll('input[type=\"file\"][accept]');
    inputs.forEach((el) => {
      if (el instanceof HTMLInputElement) patchFileInput(el);
    });
  };

  const getBlob = (url) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.responseType = 'blob';
      xhr.onload = () => resolve(xhr.response);
      xhr.onerror = () => reject(new Error('Failed to load blob URL'));
      xhr.send();
    });

  const blobToDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('Unexpected FileReader result'));
      };
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
      reader.readAsDataURL(blob);
    });

  const tryNativeSave = async (href, fileName) => {
    const downloader = window.Demo2APKBlobDownloader;
    if (href.startsWith('data:')) {
      downloader.saveBase64Data(href, fileName);
      return true;
    }

    if (href.startsWith('blob:')) {
      const blob = await getBlob(href);
      const dataUrl = await blobToDataUrl(blob);
      downloader.saveBase64Data(dataUrl, fileName);
      return true;
    }

    return false;
  };

  const onClickCapture = (event) => {
    const target = event && event.target;
    const anchor = target && target.closest ? target.closest('a') : null;
    if (!(anchor instanceof HTMLAnchorElement)) return;

    const fileName = anchor.getAttribute('download') || anchor.download;
    if (!fileName) return;

    const href = anchor.getAttribute('href') || anchor.href;
    if (!href || (!href.startsWith('blob:') && !href.startsWith('data:'))) return;

    const downloader = window.Demo2APKBlobDownloader;
    if (!downloader || typeof downloader.saveBase64Data !== 'function') return;

    event.preventDefault();

    void (async () => {
      try {
        await tryNativeSave(href, fileName);
      } catch {
        // Best-effort fallback: try default navigation.
        try {
          window.location.href = href;
        } catch {
          // Ignore
        }
      }
    })();
  };

${buildSystemBarSyncScript()}  const init = () => {
    patchFileInputs(document);
    initSystemBarSync();

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          patchFileInputs(node);
        });
      }
    });

    if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    document.addEventListener('click', onClickCapture, true);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();\n`;

export async function writeDemo2apkRuntimeScript(targetDir: string): Promise<string> {
  const outPath = path.join(targetDir, DEMO2APK_RUNTIME_SCRIPT_FILENAME);
  await fs.writeFile(outPath, DEMO2APK_RUNTIME_SCRIPT_CONTENT, 'utf8');
  return outPath;
}

export function injectDemo2apkRuntimeScriptTag(html: string): string {
  if (html.includes(DEMO2APK_RUNTIME_SCRIPT_FILENAME)) {
    return html;
  }

  const scriptTag = `    <script src="${DEMO2APK_RUNTIME_SCRIPT_FILENAME}"></script>\n`;
  const match = html.match(/<\/body\s*>/i);
  if (!match || match.index === undefined) {
    return `${html}\n${scriptTag}`;
  }

  const idx = match.index;
  return html.slice(0, idx) + scriptTag + html.slice(idx);
}
