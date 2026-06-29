/**
 * Preinstall guard: node-canvas needs native libs and the pipeline needs ffmpeg.
 * We only WARN here (never fail) so `npm install` still works in CI images that
 * provision system deps separately. Run `npm run setup` to install them on macOS.
 */
const { execSync } = require('child_process');

function has(cmd) {
  try {
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const checks = [
  { name: 'ffmpeg', ok: has('ffmpeg -version'), hint: 'brew install ffmpeg' },
  { name: 'ffprobe', ok: has('ffprobe -version'), hint: 'brew install ffmpeg' },
  {
    name: 'cairo (node-canvas)',
    ok: has('pkg-config --exists cairo'),
    hint: 'brew install pkg-config cairo pango libpng jpeg giflib librsvg',
  },
];

const missing = checks.filter((c) => !c.ok);
if (missing.length) {
  console.warn('\n⚠️  video-pipeline: missing system dependencies:');
  for (const m of missing) console.warn(`   - ${m.name}  ->  ${m.hint}`);
  console.warn('   Run `npm run setup` (macOS) or install them manually.\n');
} else {
  console.log('✅ video-pipeline: system dependencies present (ffmpeg, ffprobe, cairo).');
}
