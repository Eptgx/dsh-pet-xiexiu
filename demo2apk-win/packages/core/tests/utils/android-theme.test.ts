import { describe, it, expect } from 'vitest';
import {
  normalizeHexColor,
  extractThemeColor,
  isLightColor,
  patchStylesXml,
  patchColorsXml,
  SYSTEM_BAR_COLOR_NAME,
} from '../../src/utils/android-theme.js';

const CORDOVA_STYLES = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.NoActionBar">
        <item name="android:windowBackground">@color/windowBackground</item>
    </style>
</resources>
`;

const CAPACITOR_STYLES = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.Light.DarkActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
    </style>
    <style name="AppTheme.NoActionBar" parent="AppTheme">
        <item name="windowActionBar">false</item>
    </style>
</resources>
`;

const COLORS = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#3F51B5</color>
</resources>
`;

describe('Android Theme Utils', () => {
  describe('normalizeHexColor', () => {
    it('expands 3-digit shorthand', () => {
      expect(normalizeHexColor('#abc')).toBe('#aabbcc');
    });

    it('lowercases 6-digit hex', () => {
      expect(normalizeHexColor('#0B1020')).toBe('#0b1020');
    });

    it('drops alpha from 8-digit hex', () => {
      expect(normalizeHexColor('#0b1020ff')).toBe('#0b1020');
    });

    it('converts rgb()', () => {
      expect(normalizeHexColor('rgb(11, 16, 32)')).toBe('#0b1020');
    });

    it('returns undefined for invalid input', () => {
      expect(normalizeHexColor('not-a-color')).toBeUndefined();
    });
  });

  describe('extractThemeColor', () => {
    it('reads the theme-color content', () => {
      expect(extractThemeColor('<meta name="theme-color" content="#0b1020">')).toBe('#0b1020');
    });

    it('works when content precedes name', () => {
      expect(extractThemeColor('<meta content="#ff0000" name="theme-color">')).toBe('#ff0000');
    });

    it('ignores other meta tags', () => {
      expect(
        extractThemeColor('<meta name="viewport" content="width=device-width">')
      ).toBeUndefined();
    });

    it('returns undefined when no meta is present', () => {
      expect(extractThemeColor('<html><head></head><body></body></html>')).toBeUndefined();
    });
  });

  describe('isLightColor', () => {
    it('treats a dark color as not light', () => {
      expect(isLightColor('#0b1020')).toBe(false);
    });

    it('treats white as light', () => {
      expect(isLightColor('#ffffff')).toBe(true);
    });
  });

  describe('patchStylesXml', () => {
    it('appends transparent system bar items while keeping existing ones', () => {
      const out = patchStylesXml(CORDOVA_STYLES, ['AppTheme'], '#0b1020');
      expect(out).toContain('<item name="android:statusBarColor">@android:color/transparent</item>');
      expect(out).toContain('<item name="android:navigationBarColor">@android:color/transparent</item>');
      expect(out).toContain('<item name="android:windowLightStatusBar">false</item>');
      expect(out).toContain('<item name="android:windowBackground">@color/windowBackground</item>');
    });

    it('is idempotent', () => {
      const once = patchStylesXml(CORDOVA_STYLES, ['AppTheme'], '#0b1020');
      const twice = patchStylesXml(once, ['AppTheme'], '#0b1020');
      expect(twice).toBe(once);
    });

    it('matches style names exactly without touching siblings', () => {
      const out = patchStylesXml(CAPACITOR_STYLES, ['AppTheme'], '#0b1020');
      const siblingStart = out.indexOf('<style name="AppTheme.NoActionBar"');
      expect(siblingStart).toBeGreaterThan(-1);
      expect(out.slice(siblingStart)).not.toContain('statusBarColor');
    });

    it('patches every listed target', () => {
      const out = patchStylesXml(
        CAPACITOR_STYLES,
        ['AppTheme', 'AppTheme.NoActionBar'],
        '#0b1020'
      );
      expect((out.match(/android:statusBarColor/g) ?? []).length).toBe(2);
    });

    it('sets light icons for a light color', () => {
      const out = patchStylesXml(CORDOVA_STYLES, ['AppTheme'], '#ffffff');
      expect(out).toContain('<item name="android:windowLightStatusBar">true</item>');
    });
  });

  describe('patchColorsXml', () => {
    it('inserts the color without dropping template colors', () => {
      const out = patchColorsXml(COLORS, '#0b1020');
      expect(out).toContain(`<color name="${SYSTEM_BAR_COLOR_NAME}">#0b1020</color>`);
      expect(out).toContain('<color name="colorPrimary">#3F51B5</color>');
    });

    it('overwrites an existing value in place', () => {
      const first = patchColorsXml(COLORS, '#0b1020');
      const second = patchColorsXml(first, '#ff0000');
      expect(second).toContain(`<color name="${SYSTEM_BAR_COLOR_NAME}">#ff0000</color>`);
      expect((second.match(/demo2apk_system_bar/g) ?? []).length).toBe(1);
    });
  });
});
