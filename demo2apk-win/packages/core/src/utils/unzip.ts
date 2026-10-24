import AdmZip from 'adm-zip';

/**
 * Extract a ZIP file using adm-zip (cross-platform).
 *
 * Replaces the system `unzip` command for Windows compatibility.
 * The options parameter is kept for API compatibility with callers
 * that previously passed execa options.
 */
export async function runUnzip(args: string[]): Promise<void> {
  // Parse args: extract zip path and optional -d destination
  let zipPath: string | undefined;
  let extractDir = '.';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-d' && i + 1 < args.length) {
      extractDir = args[i + 1];
      i++; // skip next arg (the dir path)
    } else if (!args[i].startsWith('-')) {
      zipPath = args[i];
    }
  }

  if (!zipPath) {
    throw new Error('unzip: no zip file specified');
  }

  const zip = new AdmZip(zipPath);
  zip.extractAllTo(extractDir, true);
}
