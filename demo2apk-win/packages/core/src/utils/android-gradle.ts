import fs from 'fs-extra';
import path from 'path';

/**
 * Android 15+ forces edge-to-edge for apps whose targetSdk is 35 or higher and
 * then silently ignores `statusBarColor` / `navigationBarColor`. Dropping the
 * target back to 34 keeps the classic system bar behaviour our theme patch
 * relies on. Only this single version number is touched.
 */
export const ANDROID_TARGET_SDK = 34;

const VARIABLES_TARGET_RE = /(targetSdkVersion\s*=\s*)\d+/g;
const GRADLE_TARGET_RE =
  /(\btargetSdkVersion\s+)(?:\d+|project\.hasProperty\([^)]*\)\s*\?\s*[^:\n]+:\s*\d+)/;

/**
 * Lower targetSdkVersion in the generated Android project.
 * Capacitor keeps it in `variables.gradle`; Cordova bakes it into `app/build.gradle`.
 * Returns true when a value was rewritten. Never throws.
 */
export async function setAndroidTargetSdk(
  androidDir: string,
  targetSdk: number = ANDROID_TARGET_SDK
): Promise<boolean> {
  try {
    const variablesPath = path.join(androidDir, 'variables.gradle');
    if (await fs.pathExists(variablesPath)) {
      const content = await fs.readFile(variablesPath, 'utf8');
      const updated = content.replace(VARIABLES_TARGET_RE, `$1${targetSdk}`);
      if (updated === content) return false;
      await fs.writeFile(variablesPath, updated, 'utf8');
      return true;
    }

    const appGradlePath = path.join(androidDir, 'app', 'build.gradle');
    if (!(await fs.pathExists(appGradlePath))) return false;

    const content = await fs.readFile(appGradlePath, 'utf8');
    const updated = content.replace(GRADLE_TARGET_RE, `$1${targetSdk}`);
    if (updated === content) return false;
    await fs.writeFile(appGradlePath, updated, 'utf8');
    return true;
  } catch {
    return false;
  }
}
