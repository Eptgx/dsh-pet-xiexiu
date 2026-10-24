/**
 * 悬浮桌宠（Android overlay）原生注入
 *
 * 在 `cordova prepare` 之后、Gradle 构建之前执行，做四件事：
 *   1. 把 FloatingPetService / FloatingPetBridge 两个 Java 类拷进 Android 工程；
 *   2. 在 MainActivity 里注册 JS 桥 `window.FloatingPet`（权限 / 启动 / 停止 / 状态）；
 *   3. 在 AndroidManifest.xml 补悬浮窗、前台服务、通知权限与 <service> 声明；
 *   4. 把 overlay.html（宠物页面）放进 assets/www。
 *
 * 只适用于 Cordova 工程（react/Capacitor 分支的目录结构不同，暂不注入）。
 *
 * 为什么权限不够：`<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />`
 * 只是一张声明，真正把窗口画到别的 App 上面需要 WindowManager + 一个前台服务；
 * 清单里没有 <service>，权限选满也只是空头支票。
 */
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 原生代码的包名（与 MainActivity 所在包无关，用全限定名引用） */
const NATIVE_PACKAGE = 'com.demo2apk.floatingpet';
/** Java 类文件（相对 assets/android-overlay） */
const JAVA_FILES = [
  'FloatingPetService.java',
  'FloatingPetBridge.java',
  'AiClient.java',
  'TtsSpeaker.java',
];
/** 注入标记：重复执行时按它判断是否已经注入过 */
const MARKER = 'Demo2APK_floating_pet_marker';
/** 页面脚本与样式（相对 assets/android-overlay） */
const WEB_FILES = [
  'overlay.html',
  'pet.js',
  'pet.css',
  'menu.html',
  'menu.js',
  'menu.css',
  'app-icon.png',
  'app-hero.png',
];
/** 桌宠资源目录（动画 + config.json + shared-core.js）：整目录拷进 www/pet */
const PET_DIR = 'pet';

/** 需要补进 AndroidManifest 的权限 */
const PERMISSIONS = [
  'SYSTEM_ALERT_WINDOW',
  'FOREGROUND_SERVICE',
  'FOREGROUND_SERVICE_SPECIAL_USE',
  'POST_NOTIFICATIONS',
  'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
];

export interface FloatingOverlayOptions {
  /** Cordova 工程的 android 目录（platforms/android） */
  androidDir: string;
  /** Cordova 工程的 www 目录（project/www） */
  wwwDir: string;
  /** 应用包名，用于定位 MainActivity */
  appId: string;
  onProgress?: (message: string, percent?: number) => void;
  progressPercent?: number;
}

/** 资源目录：dist/utils/android-overlay.js → 包根/assets/android-overlay */
function assetDir(): string {
  return path.resolve(__dirname, '../../assets/android-overlay');
}

/** 定位 MainActivity.java（先按包名路径，找不到再整树搜索） */
async function findMainActivity(androidDir: string, appId: string): Promise<string | undefined> {
  const javaRoot = path.join(androidDir, 'app', 'src', 'main', 'java');
  const expected = path.join(javaRoot, ...appId.split('.'), 'MainActivity.java');
  if (await fs.pathExists(expected)) {
    return expected;
  }
  if (!(await fs.pathExists(javaRoot))) {
    return undefined;
  }

  const stack: string[] = [javaRoot];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name === 'MainActivity.java') {
        return full;
      }
    }
  }
  return undefined;
}

/** 在 MainActivity 里挂 JS 桥（幂等） */
async function patchMainActivity(mainActivityPath: string): Promise<boolean> {
  let source = await fs.readFile(mainActivityPath, 'utf8');
  if (source.includes(MARKER)) {
    return false;
  }

  // 桥接语句：全限定名，避免改 import；appView 是 CordovaActivity 的 protected 字段
  const bridge = [
    `        // ${MARKER}`,
    '        try {',
    '            android.webkit.WebView __fpWebView = (android.webkit.WebView) appView.getView();',
    `            __fpWebView.addJavascriptInterface(new ${NATIVE_PACKAGE}.FloatingPetBridge(this, __fpWebView), "FloatingPet");`,
    '        } catch (Exception ignored) { }',
    // 三件事各自 try：任何一步失败（老 ROM / 被 OEM 限制）都不能连累另外两步
    '        try { getWindow().setStatusBarColor(0xFF0F1115); } catch (Throwable ignored) { }',
    '        try { getWindow().setNavigationBarColor(0xFF0C0E12); } catch (Throwable ignored) { }',
    '        try { getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(0xFF0F1115)); } catch (Throwable ignored) { }',
    '',
  ].join('\n');

  const anchor = 'loadUrl(launchUrl);';
  const anchorIndex = source.indexOf(anchor);

  if (anchorIndex >= 0) {
    // onCreate 已经存在（demo2apk 的 blob 导出补丁会建一个），插在 loadUrl 之后
    const insertAt = anchorIndex + anchor.length;
    source = source.slice(0, insertAt) + '\n' + bridge + source.slice(insertAt);
  } else {
    // 没有可用的 onCreate：补一个
    const method = [
      `    // ${MARKER}`,
      '    @Override',
      '    public void onCreate(android.os.Bundle savedInstanceState) {',
      '        super.onCreate(savedInstanceState);',
      '        loadUrl(launchUrl);',
      bridge,
      '    }',
      '',
    ].join('\n');

    const closeIndex = source.lastIndexOf('}');
    if (closeIndex < 0) {
      return false;
    }
    source = source.slice(0, closeIndex) + method + source.slice(closeIndex);
  }

  await fs.writeFile(mainActivityPath, source, 'utf8');
  return true;
}

/** 补 AndroidManifest：权限 + service（幂等） */
async function patchManifest(androidDir: string): Promise<boolean> {
  const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
  if (!(await fs.pathExists(manifestPath))) {
    return false;
  }

  let source = await fs.readFile(manifestPath, 'utf8');
  if (source.includes(MARKER)) {
    return false;
  }

  const permissionBlock = [
    `    <!-- ${MARKER} -->`,
    ...PERMISSIONS.map((name) => `    <uses-permission android:name="android.permission.${name}" />`),
    // Android 11+ 包可见性：不声明这条，TTS 引擎列表（MultiTTS）可能查不到
    '    <queries>',
    '        <intent>',
    '            <action android:name="android.intent.action.TTS_SERVICE" />',
    '        </intent>',
    '    </queries>',
    '',
  ].join('\n');

  const applicationTag = source.indexOf('<application');
  if (applicationTag >= 0) {
    source = source.slice(0, applicationTag) + permissionBlock + source.slice(applicationTag);
  } else {
    const manifestClose = source.lastIndexOf('</manifest>');
    if (manifestClose < 0) {
      return false;
    }
    source = source.slice(0, manifestClose) + permissionBlock + source.slice(manifestClose);
  }

  // Android 14（targetSdk 34）起，前台服务必须声明类型；specialUse 是悬浮类服务的正解
  const serviceBlock = [
    `        <!-- ${MARKER} -->`,
    '        <service',
    `            android:name="${NATIVE_PACKAGE}.FloatingPetService"`,
    '            android:exported="false"',
    '            android:foregroundServiceType="specialUse">',
    '            <property',
    '                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"',
    '                android:value="floating_pet_overlay" />',
    '        </service>',
    '',
  ].join('\n');

  const applicationClose = source.lastIndexOf('</application>');
  if (applicationClose < 0) {
    return false;
  }
  source = source.slice(0, applicationClose) + serviceBlock + source.slice(applicationClose);

  // 键盘弹起时把页面顶上去（对话页的输入框需要），而不是把整个窗口平移
  if (!source.includes('android:windowSoftInputMode')) {
    source = source.replace(
      /(<activity\b[^>]*android:name\s*=\s*["'][^"']*MainActivity["'][^>]*?)(\s*>)/,
      '$1 android:windowSoftInputMode="adjustResize"$2',
    );
  }

  await fs.writeFile(manifestPath, source, 'utf8');
  return true;
}

/**
 * 窗口背景 = App 底色。
 * 状态栏/导航栏是透明的（demo2apk 的 applyAndroidSystemBarTheme 会设），露出的是窗口背景；
 * 不设的话会露出 AppCompat 默认灰，和深色页面断开。顺带消掉启动瞬间的白屏。
 */
async function patchWindowBackground(androidDir: string): Promise<boolean> {
  const stylesPath = path.join(androidDir, 'app', 'src', 'main', 'res', 'values', 'styles.xml');
  if (!(await fs.pathExists(stylesPath))) return false;

  let xml = await fs.readFile(stylesPath, 'utf8');
  if (xml.includes('Demo2APK_pet_window_bg')) return false;

  // Cordova 的 Activity 可能用 AppTheme / AppTheme.NoActionBar / AppTheme.NoActionBarLaunch，
  // 不确认到底哪个生效，就全都写一遍（含覆盖启动主题自带的 windowBackground，顺便消掉白屏）。
  const names = ['AppTheme', 'AppTheme.NoActionBar', 'AppTheme.NoActionBarLaunch'];
  const item =
    '        <!-- Demo2APK_pet_window_bg -->\n' +
    '        <item name="android:windowBackground">#0F1115</item>\n' +
    '        <item name="android:statusBarColor">#0F1115</item>\n' +
    '        <item name="android:navigationBarColor">#0C0E12</item>\n';

  let patched = false;
  for (const name of names) {
    const escaped = name.replace(/\./g, '\\.');
    const open = new RegExp(`<style\\b[^>]*\\bname\\s*=\\s*["']${escaped}["'][^>]*>`, 'i').exec(xml);
    if (!open) continue;

    const start = open.index + open[0].length;
    const closeRel = xml.slice(start).indexOf('</style>');
    if (closeRel < 0) continue;
    const at = start + closeRel;

    // 把既有颜色项删掉再写我们的：demo2apk 的 applyAndroidSystemBarTheme 会先写透明的，
    // 这里必须覆盖它，否则状态栏又变成透明 + 黑底。
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

/**
 * 注入悬浮桌宠原生能力。
 * @returns 是否发生了实际改动（重复构建时为 false）
 */
export async function injectFloatingOverlay(options: FloatingOverlayOptions): Promise<boolean> {
  const { androidDir, wwwDir, appId, onProgress, progressPercent } = options;

  if (!(await fs.pathExists(androidDir))) {
    return false;
  }

  onProgress?.('Injecting floating pet (Android overlay)...', progressPercent);

  const source = assetDir();
  if (!(await fs.pathExists(source))) {
    onProgress?.('Floating pet assets missing, skipped', progressPercent);
    return false;
  }

  // 1. 原生类
  const javaDir = path.join(androidDir, 'app', 'src', 'main', 'java', ...NATIVE_PACKAGE.split('.'));
  await fs.ensureDir(javaDir);
  for (const file of JAVA_FILES) {
    await fs.copy(path.join(source, file), path.join(javaDir, file));
  }

  // 2. 悬浮页与资源：project/www 与 assets/www 都放一份。
  //    只写 assets 会被 Gradle 的资源拷贝任务覆盖，只写 www 则 prepare 已经跑过、来不及同步。
  const assetsWww = path.join(androidDir, 'app', 'src', 'main', 'assets', 'www');
  await fs.ensureDir(assetsWww);
  for (const dir of [wwwDir, assetsWww]) {
    if (!(await fs.pathExists(dir))) continue;
    for (const file of WEB_FILES) {
      const from = path.join(source, file);
      if (await fs.pathExists(from)) {
        await fs.copy(from, path.join(dir, file));
      }
    }
    const petFrom = path.join(source, PET_DIR);
    if (await fs.pathExists(petFrom)) {
      await fs.copy(petFrom, path.join(dir, PET_DIR), { overwrite: true });
    }
  }

  // 3. MainActivity 桥
  const mainActivity = await findMainActivity(androidDir, appId);
  if (mainActivity === undefined) {
    onProgress?.('MainActivity.java not found, floating pet bridge skipped', progressPercent);
  } else {
    await patchMainActivity(mainActivity);
  }

  // 4. Manifest
  await patchManifest(androidDir);

  // 5. 主题：状态栏/手势条后面的窗口背景 = App 底色
  await patchWindowBackground(androidDir);

  onProgress?.('Floating pet injected', progressPercent);
  return true;
}
