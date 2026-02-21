/**
 * Download yt-dlp binaries for bundling into the Electron app.
 *
 * Usage:
 *   node scripts/download-yt-dlp.js mac    # macOS arm64 binary → build/bin/mac/yt-dlp
 *   node scripts/download-yt-dlp.js win    # Windows x64 binary → build/bin/win/yt-dlp.exe
 *   node scripts/download-yt-dlp.js all    # both
 */

const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const BINARIES = {
  mac: {
    url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
    dest: path.join(__dirname, '..', 'build', 'bin', 'mac', 'yt-dlp'),
    executable: true,
  },
  win: {
    url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
    dest: path.join(__dirname, '..', 'build', 'bin', 'win', 'yt-dlp.exe'),
    executable: false,
  },
};

function download(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    const doRequest = (targetUrl) => {
      https.get(targetUrl, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          doRequest(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`));
          return;
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
      }).on('error', reject);
    };

    doRequest(url);
  });
}

async function main() {
  const target = process.argv[2];
  if (!target || !['mac', 'win', 'all'].includes(target)) {
    console.error('Usage: node scripts/download-yt-dlp.js <mac|win|all>');
    process.exit(1);
  }

  const targets = target === 'all' ? ['mac', 'win'] : [target];

  for (const t of targets) {
    const { url, dest, executable } = BINARIES[t];
    console.log(`Downloading yt-dlp [${t}] → ${dest}`);
    await download(url, dest);
    if (executable) fs.chmodSync(dest, 0o755);
    console.log(`  Done: ${dest}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
