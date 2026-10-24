import { describe, it, expect } from 'vitest';
import {
  normalizeThemeColor,
  buildSystemBarSyncScript,
  DEMO2APK_RUNTIME_SCRIPT_CONTENT,
} from '../../src/utils/webview-compat.js';

/**
 * Pull `normalizeBarColor` out of the generated runtime script so the embedded
 * copy can be checked against the TypeScript one they are supposed to mirror.
 */
function createScriptNormalizer(): (raw: unknown) => string | null {
  const factory = new Function(
    `return (function () { ${buildSystemBarSyncScript()} return normalizeBarColor; })();`
  );
  return factory() as (raw: unknown) => string | null;
}

/**
 * Evaluate a single function from the generated runtime script in an isolated
 * scope, so the test can hand it its own `window` / `document` / `JSON`.
 */
function createSandboxFunction(
  name: string
): (fakeWindow: unknown, fakeDocument: unknown, json: unknown) => (...args: unknown[]) => unknown {
  return new Function(
    'window',
    'document',
    'JSON',
    `return (function () { ${buildSystemBarSyncScript()} return ${name}; })();`
  ) as (fakeWindow: unknown, fakeDocument: unknown, json: unknown) => (...args: unknown[]) => unknown;
}

describe('WebView compat runtime script', () => {
  describe('normalizeThemeColor', () => {
    it('keeps 6-digit hex', () => {
      expect(normalizeThemeColor('#123456')).toBe('#123456');
    });

    it('lowercases hex', () => {
      expect(normalizeThemeColor('#0B1020')).toBe('#0b1020');
    });

    it('expands 3-digit shorthand', () => {
      expect(normalizeThemeColor('#abc')).toBe('#aabbcc');
    });

    it('drops alpha from 8-digit hex', () => {
      expect(normalizeThemeColor('#12345680')).toBe('#123456');
    });

    it('rejects fully transparent 8-digit hex', () => {
      expect(normalizeThemeColor('#12345600')).toBeUndefined();
    });

    it('converts rgb()', () => {
      expect(normalizeThemeColor('rgb(18, 52, 86)')).toBe('#123456');
    });

    it('converts rgba() with alpha', () => {
      expect(normalizeThemeColor('rgba(11, 16, 32, 0.5)')).toBe('#0b1020');
    });

    it('rejects fully transparent rgba()', () => {
      expect(normalizeThemeColor('rgba(11, 16, 32, 0)')).toBeUndefined();
    });

    it('rejects transparent keyword', () => {
      expect(normalizeThemeColor('transparent')).toBeUndefined();
    });

    it('rejects empty and invalid input', () => {
      expect(normalizeThemeColor('')).toBeUndefined();
      expect(normalizeThemeColor('   ')).toBeUndefined();
      expect(normalizeThemeColor(null)).toBeUndefined();
      expect(normalizeThemeColor(undefined)).toBeUndefined();
      expect(normalizeThemeColor('not-a-color')).toBeUndefined();
    });
  });

  describe('buildSystemBarSyncScript', () => {
    const script = buildSystemBarSyncScript();

    it('contains no backtick or unresolved template interpolation', () => {
      expect(script).not.toContain('`');
      expect(script).not.toContain('${');
    });

    it('keeps regex escapes intact', () => {
      expect(script).toContain('rgba?\\(\\s*');
    });

    it('listens for theme changes through the expected channels', () => {
      expect(script).toContain('window.Demo2APKSystemBar.setColor');
      expect(script).toContain('MutationObserver');
      expect(script).toContain('prefers-color-scheme');
      expect(script).toContain('visibilitychange');
      expect(script).toContain('data-theme');
    });

    it('exposes the manual escape hatch', () => {
      expect(script).toContain('window.Demo2APK = {');
      expect(script).toContain('setSystemBarColor');
      expect(script).toContain('refreshSystemBar');
    });

    it('publishes the native safe area as CSS variables', () => {
      expect(script).toContain('--demo2apk-safe-top');
      expect(script).toContain('--demo2apk-safe-bottom');
      expect(script).toContain('getSafeAreaInsets');
      expect(script).toContain('refreshSafeArea');
    });

    it('mirrors native diagnostics into the page console', () => {
      expect(script).toContain('getDiagnostics');
      expect(script).toContain("console.warn('[Demo2APK] '");
    });

    it('prints each diagnostics batch only once', () => {
      const warnings: string[] = [];
      const fakeWindow = {
        Demo2APKSystemBar: { getDiagnostics: () => '["setColor(#xxx): java.lang.IllegalArgumentException"]' },
        console: { warn: (message: string) => { warnings.push(message); } },
      };

      const reportDiagnostics = createSandboxFunction('reportDiagnostics');
      const report = reportDiagnostics(fakeWindow, {}, JSON);

      expect(report()).toBe(true);
      expect(report()).toBe(true);
      expect(warnings).toEqual(['[Demo2APK] setColor(#xxx): java.lang.IllegalArgumentException']);
    });

    it('applies the insets reported by the bridge', () => {
      const written: Record<string, string> = {};
      const fakeWindow = {
        Demo2APKSystemBar: { getSafeAreaInsets: () => '{"top":48,"bottom":16}' },
      };
      const fakeDocument = {
        documentElement: { style: { setProperty: (key: string, value: string) => { written[key] = value; } } },
      };

      const syncSafeArea = createSandboxFunction('syncSafeArea')(fakeWindow, fakeDocument, JSON);
      expect(syncSafeArea()).toBe(true);
      expect(written['--demo2apk-safe-top']).toBe('48px');
      expect(written['--demo2apk-safe-bottom']).toBe('16px');
    });

    it('skips the safe area when the insets are unusable', () => {
      const written: Record<string, string> = {};
      const fakeDocument = {
        documentElement: { style: { setProperty: (key: string, value: string) => { written[key] = value; } } },
      };

      const build = createSandboxFunction('syncSafeArea');

      expect(build({}, fakeDocument, JSON)()).toBe(false);
      expect(
        build({ Demo2APKSystemBar: { getSafeAreaInsets: () => null } }, fakeDocument, JSON)()
      ).toBe(false);
      expect(
        build({ Demo2APKSystemBar: { getSafeAreaInsets: () => 'not-json' } }, fakeDocument, JSON)()
      ).toBe(false);
      expect(Object.keys(written)).toEqual([]);
    });

    it('mirrors normalizeThemeColor for the same inputs', () => {
      const scriptNormalize = createScriptNormalizer();
      const samples = [
        '#123456',
        '#0B1020',
        '#abc',
        '#12345680',
        '#12345600',
        'rgb(18, 52, 86)',
        'rgba(11, 16, 32, 0.5)',
        'rgba(11, 16, 32, 0)',
        'transparent',
        '',
        'not-a-color',
      ];

      for (const sample of samples) {
        expect(scriptNormalize(sample)).toBe(normalizeThemeColor(sample) ?? null);
      }
    });
  });

  describe('DEMO2APK_RUNTIME_SCRIPT_CONTENT', () => {
    it('embeds the system bar sync block', () => {
      expect(DEMO2APK_RUNTIME_SCRIPT_CONTENT).toContain(buildSystemBarSyncScript());
    });

    it('starts the sync during init', () => {
      expect(DEMO2APK_RUNTIME_SCRIPT_CONTENT).toContain('initSystemBarSync();');
    });

    it('still injects the download bridge', () => {
      expect(DEMO2APK_RUNTIME_SCRIPT_CONTENT).toContain('Demo2APKBlobDownloader');
    });
  });
});
