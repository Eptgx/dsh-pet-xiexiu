/**
 * Cordova（HTML 打包分支）的系统栏修复。
 *
 * 背景：targetSdk 34 下不开边到边时，状态栏/导航栏会显示「窗口背景」；
 * 而 applyAndroidSystemBarTheme 会把两条栏写成透明，页面又没有铺满窗口背景，
 * 结果就是状态栏、导航栏一片纯黑。
 *
 * 做法（顺序不能反，必须在 applyAndroidSystemBarTheme 之后执行）：
 *   1. 主题里把三条颜色写成不透明（并删掉同名的旧项），顺便消掉启动白屏；
 *   2. Activity 运行时再设一次，三步各自 try，任何一步失败都不连累其它两步。
 */
import fs from 'fs-extra';
import path from 'node:path';

const MARKER = 'Demo2APK_classic_system_bars';
const STATUS_BAR = '#0F1115';
const NAV_BAR = '#0C0E12';
const WINDOW_BG = '#0F1115';

async function findMainActivity(androidDir: string, appId: string): Promise<string | undefined> {
  const direct = path.join(
    androidDir,
    'app',
    'src',
    'main',
    'java',
    appId.replace(/\./g, path.sep),
    'MainActivity.java',
  );
  if (await fs.pathExists(direct)) return direct;

  const root = path.join(androidDir, 'app', 'src', 'main', 'java');
  if (!(await fs.pathExists(root))) return undefined;

  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === 'MainActivity.java') return full;
    }
  }
  return undefined;
}

async function patchThemes(androidDir: string): Promise<boolean> {
  const stylesPath = path.join(androidDir, 'app', 'src', 'main', 'res', 'values', 'styles.xml');
  if (!(await fs.pathExists(stylesPath))) return false;

  let xml = await fs.readFile(stylesPath, 'utf8');
  if (xml.includes(MARKER)) return false;

  // Cordova 的 Activity 可能用这三个主题里的任意一个，全都写一遍
  const names = ['AppTheme', 'AppTheme.NoActionBar', 'AppTheme.NoActionBarLaunch'];
  const item =
    `    <!-- ${MARKER} -->\n` +
    `    <item name="android:windowBackground">${WINDOW_BG}</item>\n` +
    `    <item name="android:statusBarColor">${STATUS_BAR}</item>\n` +
    `    <item name="android:navigationBarColor">${NAV_BAR}</item>\n`;

  let patched = false;
  for (const name of names) {
    const escaped = name.replace(/\./g, '\\.');
    const open = new RegExp(`<style\\b[^>]*\\bname\\s*=\\s*["']${escaped}["'][^>]*>`, 'i').exec(xml);
    if (!open) continue;

    const start = open.index + open[0].length;
    const closeRel = xml.slice(start).indexOf('</style>');
    if (closeRel < 0) continue;
    const at = start + closeRel;

    // 先删掉 applyAndroidSystemBarTheme 写的透明项，再写我们的
    const block = xml
      .slice(start, at)
      .replace(
        /[ \t]*<item\s+name="android:(windowBackground|statusBarColor|navigationBarColor)">[^<]*<\/item>\r?\n?/g,
        '',
      );
    xml = xml.slice(0, start) + block + item + xml.slice(at);
    patched = true;
  }

  if (!patched) return false;
  await fs.writeFile(stylesPath, xml, 'utf8');
  return true;
}

async function patchActivity(activityPath: string): Promise<boolean> {
  let source = await fs.readFile(activityPath, 'utf8');
  if (source.includes(MARKER)) return false;

  const code = [
    `        // ${MARKER}`,
    '        try { getWindow().setStatusBarColor(0xFF0F1115); } catch (Throwable ignored) { }',
    '        try { getWindow().setNavigationBarColor(0xFF0C0E12); } catch (Throwable ignored) { }',
    '        try { getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(0xFF0F1115)); } catch (Throwable ignored) { }',
    '',
  ].join('\n');

  const anchor = 'loadUrl(launchUrl);';
  const index = source.indexOf(anchor);
  if (index >= 0) {
    const at = index + anchor.length;
    source = source.slice(0, at) + '\n' + code + source.slice(at);
  } else {
    const close = source.lastIndexOf('}');
    if (close < 0) return false;
    const method = [
      `    // ${MARKER}`,
      '    @Override',
      '    public void onCreate(android.os.Bundle savedInstanceState) {',
      '        super.onCreate(savedInstanceState);',
      '        loadUrl(launchUrl);',
      code,
      '    }',
      '',
    ].join('\n');
    source = source.slice(0, close) + method + source.slice(close);
  }

  await fs.writeFile(activityPath, source, 'utf8');
  return true;
}

/**
 * 修 Cordova 分支的状态栏/导航栏颜色。
 * 必须在 applyAndroidSystemBarTheme 之后调用（它会写透明，这里覆盖）。
 */
export async function applyClassicSystemBars(options: {
  androidDir: string;
  appId: string;
  onProgress?: (message: string) => void;
}): Promise<boolean> {
  const { androidDir, appId, onProgress } = options;
  if (!(await fs.pathExists(androidDir))) return false;

  onProgress?.('Applying opaque system bar colors...');
  const themed = await patchThemes(androidDir);
  const activityPath = await findMainActivity(androidDir, appId);
  const activity = activityPath ? await patchActivity(activityPath) : false;
  return themed || activity;
}
