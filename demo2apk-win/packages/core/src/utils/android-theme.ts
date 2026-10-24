import fs from 'fs-extra';
import path from 'path';

export const SYSTEM_BAR_MARKER = 'Demo2APK_system_bar_marker';
export const SYSTEM_BAR_COLOR_NAME = 'demo2apk_system_bar';
export const DEFAULT_SYSTEM_BAR_COLOR = '#0b1020';

const SYSTEM_BAR_ITEM_NAMES = [
  'android:statusBarColor',
  'android:navigationBarColor',
  'android:windowLightStatusBar',
  'android:windowLightNavigationBar',
];

export interface ApplySystemBarThemeOptions {
  androidDir: string;
  themeNames: string[];
  color?: string;
  onProgress?: (message: string, percent?: number) => void;
}

/**
 * Normalize a CSS color into `#RRGGBB`. Alpha is dropped so the system bar
 * stays opaque. Returns undefined for anything we cannot parse.
 */
export function normalizeHexColor(input: string): string | undefined {
  const value = input.trim().toLowerCase();
  if (!value) return undefined;

  let match = value.match(/^#([0-9a-f]{3})$/);
  if (match) {
    const rgb = match[1];
    return `#${rgb[0]}${rgb[0]}${rgb[1]}${rgb[1]}${rgb[2]}${rgb[2]}`;
  }

  match = value.match(/^#([0-9a-f]{6})$/);
  if (match) return `#${match[1]}`;

  match = value.match(/^#([0-9a-f]{8})$/);
  if (match) return `#${match[1].slice(0, 6)}`;

  match = value.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
  if (match) {
    const toHex = (n: string) => Math.min(255, parseInt(n, 10)).toString(16).padStart(2, '0');
    return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`;
  }

  return undefined;
}

/**
 * Read the first `<meta name="theme-color">` from an HTML document.
 * Attributes are extracted individually so ordering does not matter.
 */
export function extractThemeColor(html: string): string | undefined {
  if (!html) return undefined;

  const metaRe = /<meta\b[^>]*>/gi;
  let tag: RegExpExecArray | null;
  while ((tag = metaRe.exec(html)) !== null) {
    const nameMatch = tag[0].match(/\bname\s*=\s*["']([^"']*)["']/i);
    if (!nameMatch || nameMatch[1].trim().toLowerCase() !== 'theme-color') continue;

    const contentMatch = tag[0].match(/\bcontent\s*=\s*["']([^"']*)["']/i);
    const color = contentMatch ? normalizeHexColor(contentMatch[1]) : undefined;
    if (color) return color;
  }

  return undefined;
}

/**
 * Relative luminance test. Light colors need dark system bar icons.
 */
export function isLightColor(hex: string): boolean {
  const normalized = normalizeHexColor(hex) ?? DEFAULT_SYSTEM_BAR_COLOR;
  const raw = normalized.slice(1);
  const channels = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16) / 255);
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance =
    0.2126 * linear(channels[0]) + 0.7152 * linear(channels[1]) + 0.0722 * linear(channels[2]);
  return luminance > 0.5;
}

function buildSystemBarItems(color: string): string {
  const light = isLightColor(color) ? 'true' : 'false';
  // Edge-to-edge: the system bars stay transparent so the page background shows
  // through and follows the app theme automatically. `color` is only used to
  // decide whether the bar icons need to be light or dark.
  return (
    `        <!-- ${SYSTEM_BAR_MARKER} -->\n` +
    `        <item name="android:statusBarColor">@android:color/transparent</item>\n` +
    `        <item name="android:navigationBarColor">@android:color/transparent</item>\n` +
    `        <item name="android:windowLightStatusBar">${light}</item>\n` +
    `        <item name="android:windowLightNavigationBar">${light}</item>\n`
  );
}

/**
 * Remove any previously injected items so re-running is idempotent.
 */
function stripSystemBarItems(xml: string): string {
  const itemNames = SYSTEM_BAR_ITEM_NAMES.join('|');
  return xml
    .replace(new RegExp(`[ \\t]*<!--\\s*${SYSTEM_BAR_MARKER}\\s*-->\\r?\\n?`, 'gi'), '')
    .replace(
      new RegExp(
        `[ \\t]*<item\\s+name=["'](?:${itemNames})["'][^>]*?(?:/>|>[^<]*</item>)\\r?\\n?`,
        'gi'
      ),
      ''
    );
}

/**
 * Locate the closing `</style>` of an exactly-named style, so appending items
 * never touches a sibling style whose name merely shares a prefix.
 */
function findStyleCloseIndex(xml: string, name: string): number | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openRe = new RegExp(`<style\\b[^>]*\\bname\\s*=\\s*["']${escaped}["'][^>]*>`, 'i');
  const match = openRe.exec(xml);
  if (!match) return undefined;

  const contentStart = match.index + match[0].length;
  const closeRel = xml.slice(contentStart).indexOf('</style>');
  if (closeRel === -1) return undefined;
  return contentStart + closeRel;
}

/**
 * Append the system bar items to each target style. Existing style declarations
 * (name, parent) are left untouched; only `<item>` children are added.
 */
export function patchStylesXml(xml: string, themeNames: string[], color: string): string {
  let output = stripSystemBarItems(xml);
  const items = buildSystemBarItems(color);
  const targets = themeNames.length > 0 ? themeNames : ['AppTheme'];

  let patched = false;
  for (const name of targets) {
    const closeIndex = findStyleCloseIndex(output, name);
    if (closeIndex === undefined) continue;
    // Drop the closing tag's own indentation before injecting, then restore a
    // single 4-space indent so repeated runs produce identical output.
    const head = output.slice(0, closeIndex).replace(/[ \t]*$/, '');
    output = `${head}${items}    ${output.slice(closeIndex)}`;
    patched = true;
  }

  if (patched) return output;

  const fallback =
    `    <style name="${targets[0]}" parent="Theme.AppCompat.NoActionBar">\n` +
    `${items}    </style>\n`;
  if (/<\/resources\s*>/i.test(output)) {
    return output.replace(/<\/resources\s*>/i, `${fallback}</resources>`);
  }
  return output;
}

/**
 * Write or overwrite the dedicated color entry without touching template colors.
 */
export function patchColorsXml(xml: string, color: string): string {
  const existing = new RegExp(
    `(<color\\s+name=["']${SYSTEM_BAR_COLOR_NAME}["']\\s*>)[^<]*(</color>)`,
    'i'
  );
  if (existing.test(xml)) {
    return xml.replace(existing, `$1${color}$2`);
  }

  const block =
    `    <!-- ${SYSTEM_BAR_MARKER} -->\n` +
    `    <color name="${SYSTEM_BAR_COLOR_NAME}">${color}</color>\n`;
  return xml.replace(/<\/resources\s*>/i, `${block}</resources>`);
}

/**
 * Apply the theme color to the generated Android project's system bars.
 * Never throws: a failure here must not break the APK build.
 */
export async function applyAndroidSystemBarTheme(
  options: ApplySystemBarThemeOptions
): Promise<boolean> {
  const { androidDir, themeNames, color, onProgress } = options;
  const valuesDir = path.join(androidDir, 'app', 'src', 'main', 'res', 'values');

  try {
    if (!(await fs.pathExists(valuesDir))) return false;

    const normalized = normalizeHexColor(color ?? '') ?? DEFAULT_SYSTEM_BAR_COLOR;

    const stylesPath = path.join(valuesDir, 'styles.xml');
    const stylesXml = (await fs.pathExists(stylesPath))
      ? await fs.readFile(stylesPath, 'utf8')
      : '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n';
    await fs.writeFile(stylesPath, patchStylesXml(stylesXml, themeNames, normalized), 'utf8');

    const colorsPath = path.join(valuesDir, 'colors.xml');
    const colorsXml = (await fs.pathExists(colorsPath))
      ? await fs.readFile(colorsPath, 'utf8')
      : '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n';
    await fs.writeFile(colorsPath, patchColorsXml(colorsXml, normalized), 'utf8');

    onProgress?.(`Matched Android system bars to ${normalized}`);
    return true;
  } catch {
    return false;
  }
}
