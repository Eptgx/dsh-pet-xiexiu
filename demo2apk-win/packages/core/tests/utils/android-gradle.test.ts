import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { setAndroidTargetSdk, ANDROID_TARGET_SDK } from '../../src/utils/android-gradle.js';

const CAPACITOR_VARIABLES = `ext {
    minSdkVersion = 23
    compileSdkVersion = 36
    targetSdkVersion = 36
    androidxActivityVersion = '1.9.2'
}
`;

const CORDOVA_APP_GRADLE = `android {
    defaultConfig {
        minSdkVersion 24
        targetSdkVersion project.hasProperty('targetSdkVersion') ? rootProject.ext.targetSdkVersion : 36
    }
}
`;

describe('Android Gradle Utils', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'demo2apk-gradle-'));
  });

  afterEach(async () => {
    await fs.remove(workDir);
  });

  it('lowers targetSdkVersion in Capacitor variables.gradle', async () => {
    await fs.writeFile(path.join(workDir, 'variables.gradle'), CAPACITOR_VARIABLES, 'utf8');

    const changed = await setAndroidTargetSdk(workDir);

    expect(changed).toBe(true);
    const result = await fs.readFile(path.join(workDir, 'variables.gradle'), 'utf8');
    expect(result).toContain(`targetSdkVersion = ${ANDROID_TARGET_SDK}`);
    expect(result).toContain('compileSdkVersion = 36');
    expect(result).toContain("androidxActivityVersion = '1.9.2'");
  });

  it('is a no-op when the value is already correct', async () => {
    await fs.writeFile(
      path.join(workDir, 'variables.gradle'),
      CAPACITOR_VARIABLES.replace('= 36\n    androidx', '= 34\n    androidx'),
      'utf8'
    );

    expect(await setAndroidTargetSdk(workDir)).toBe(false);
  });

  it('lowers targetSdkVersion in Cordova app/build.gradle', async () => {
    const appDir = path.join(workDir, 'app');
    await fs.ensureDir(appDir);
    await fs.writeFile(path.join(appDir, 'build.gradle'), CORDOVA_APP_GRADLE, 'utf8');

    const changed = await setAndroidTargetSdk(workDir);

    expect(changed).toBe(true);
    const result = await fs.readFile(path.join(appDir, 'build.gradle'), 'utf8');
    expect(result).toContain(`targetSdkVersion ${ANDROID_TARGET_SDK}`);
    expect(result).toContain('minSdkVersion 24');
  });

  it('returns false when no gradle file exists', async () => {
    expect(await setAndroidTargetSdk(workDir)).toBe(false);
  });
});
