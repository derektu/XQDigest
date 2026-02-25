const axios = require('axios');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RssParser = require('rss-parser');
const Logger = require('../logger');

class PermanentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermanentError';
    this.permanent = true;
  }
}

// Subtitle language priority: Traditional Chinese, Simplified Chinese, English.
// zh-TW / zh-Hant = 繁體中文（兩種代碼皆可能出現）
// zh-Hans / zh-CN = 簡體中文（兩種代碼皆可能出現）
// en = 英文 fallback
const TRANSCRIPT_LANG_PRIORITY = ['zh-TW', 'zh-Hant', 'zh-Hans', 'zh-CN', 'en'];

class YouTubeFetcher {
  static CHANNEL_URL_PATTERN = /^https?:\/\/(?:www\.)?youtube\.com\/(?:@(?:[\w.-]|%[0-9A-Fa-f]{2})+|channel\/UC[\w-]+|c\/[\w.-]+)\/?$/;

  static validateChannelUrl(url) {
    return YouTubeFetcher.CHANNEL_URL_PATTERN.test(url);
  }

  constructor({ logger, ytDlpBin } = {}) {
    this.logger = logger || Logger.getLogger('YouTubeFetcher');
    this._rssParser = new RssParser();
    this._ytDlpBin = ytDlpBin || 'yt-dlp';
  }

  /**
   * Fetch recent video IDs from a YouTube channel.
   * Uses the channel's RSS feed (no API key required).
   * @param {string} channelUrl - YouTube channel URL (e.g. https://www.youtube.com/@channelname)
   * @returns {Array<{videoId, title, publishedDate, url}>}
   */
  async fetchRecentVideos(channelUrl) {
    if (!YouTubeFetcher.validateChannelUrl(channelUrl)) {
      throw new Error(`Invalid YouTube channel URL format: ${channelUrl}`);
    }

    const channelId = await this._resolveChannelId(channelUrl);
    if (!channelId) {
      throw new Error(`Cannot resolve channel ID from URL: ${channelUrl}`);
    }

    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const feed = await this._rssParser.parseURL(feedUrl);

    const items = feed.items.map(item => ({
      videoId: this._extractVideoId(item.link),
      title: item.title,
      publishedDate: item.pubDate || item.isoDate,
      url: item.link,
      author: feed.title,
    }));
    return items.filter(v => !this._isShorts(v));
  }

  /**
   * Fetch recent videos from a YouTube channel using yt-dlp.
   * Uses the /videos tab which naturally excludes Shorts.
   * More accurate than RSS for channels that post many Shorts,
   * at the cost of being slower (~1-2s per video fetched).
   * @param {string} channelUrl - YouTube channel URL
   * @param {number} maxFetch - Max videos to retrieve (processed newest-first)
   * @returns {Array<{videoId, title, publishedDate, url, author}>}
   */
  fetchRecentVideosByYtDlp(channelUrl, maxFetch = 30) {
    // Strip trailing /videos if present, then append cleanly
    const videosUrl = channelUrl.replace(/\/videos\/?$/, '').replace(/\/?$/, '/videos');
    const args = [
      '--no-warnings', '--ignore-errors', '--skip-download', '--dump-json',
      '--playlist-end', String(maxFetch),
      videosUrl,
    ];
    return new Promise((resolve, reject) => {
      execFile(this._ytDlpBin, args, { timeout: 120000, maxBuffer: 50 * 1024 * 1024 }, (err, stdout) => {
        const results = [];
        for (const line of (stdout || '').split('\n')) {
          if (!line.trim()) continue;
          try {
            const d = JSON.parse(line);
            if (!d.id) continue;
            // Skip upcoming or currently live events — no transcript available yet.
            // 'was_live' (finished streams) are kept since they may have transcripts.
            if (d.is_live || d.live_status === 'is_upcoming' || d.live_status === 'is_live') continue;
            const ud = d.upload_date; // YYYYMMDD or null
            results.push({
              videoId: d.id,
              title: d.title,
              publishedDate: ud ? `${ud.slice(0, 4)}-${ud.slice(4, 6)}-${ud.slice(6, 8)}` : null,
              url: d.webpage_url || `https://www.youtube.com/watch?v=${d.id}`,
              author: d.channel || d.uploader,
            });
          } catch {}
        }
        if (results.length > 0) {
          resolve(results); // 有 partial 結果就當作成功
        } else if (err) {
          reject(err);      // 完全沒有結果才 reject
        } else {
          resolve([]);
        }
      });
    });
  }

  /**
   * Fetch recent videos by combining RSS and yt-dlp results.
   * - yt-dlp (/videos tab): primary source, excludes Shorts, up to maxFetch videos
   * - RSS: fallback/supplement, up to 15 videos, filtered for Shorts
   * Both run in parallel; results are unioned by videoId (yt-dlp preferred).
   * If yt-dlp has null publishedDate for a video, RSS date is used as fallback.
   * @param {string} channelUrl - YouTube channel URL
   * @param {number} maxFetch - Max videos to retrieve via yt-dlp
   * @returns {Array<{videoId, title, publishedDate, url, author}>}
   */
  async fetchRecentVideosCombined(channelUrl, maxFetch = 30) {
    const [rssResult, ytdlpResult] = await Promise.allSettled([
      this.fetchRecentVideos(channelUrl),
      this.fetchRecentVideosByYtDlp(channelUrl, maxFetch),
    ]);

    const rssVideos = rssResult.status === 'fulfilled' ? rssResult.value : [];
    const ytdlpVideos = ytdlpResult.status === 'fulfilled' ? ytdlpResult.value : [];

    // RSS lookup for date fallback
    const rssMap = new Map(rssVideos.map(v => [v.videoId, v]));

    // yt-dlp results (primary): supplement null publishedDate from RSS
    const ytdlpProcessed = ytdlpVideos.map(v => ({
      ...v,
      publishedDate: v.publishedDate ?? rssMap.get(v.videoId)?.publishedDate ?? null,
    }));

    // RSS-only videos (not in yt-dlp): filter Shorts
    const ytdlpIds = new Set(ytdlpVideos.map(v => v.videoId));
    const rssOnly = rssVideos
      .filter(v => !ytdlpIds.has(v.videoId))
      .filter(v => !this._isShorts(v));

    return [...ytdlpProcessed, ...rssOnly];
  }

  /**
   * Detect if a video is a YouTube Short.
   * Checks URL for /shorts/ path or title for #Shorts hashtag.
   */
  _isShorts(video) {
    if (video.url && video.url.includes('/shorts/')) return true;
    if (video.title && /#shorts\b/i.test(video.title)) return true;
    return false;
  }

  /**
   * Download transcript for a YouTube video using yt-dlp.
   * Step 1: Query available subtitle languages via --dump-json.
   * Step 2: Pick the best single language from TRANSCRIPT_LANG_PRIORITY.
   * Step 3: Download only that one language to minimize HTTP requests.
   * @param {string} videoId
   * @returns {string} Full transcript text
   */
  async fetchTranscript(videoId) {
    const { manual, auto } = await this._getAvailableLangs(videoId);
    const bestLang = this._pickBestLang(manual, auto);
    if (!bestLang) {
      throw new PermanentError(`yt-dlp: no subtitles found for ${videoId}`);
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-sub-'));
    try {
      await this._runYtDlp(videoId, tmpDir, bestLang);
      const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.vtt'));
      if (files.length > 0) {
        const picked = this._pickBestVtt(files) || files[0];
        const vtt = fs.readFileSync(path.join(tmpDir, picked), 'utf-8');
        const text = this._parseVTT(vtt);
        if (text.length > 0) {
          const lang = picked.match(/\.([^.]+)\.vtt$/)?.[1] || 'unknown';
          this.logger.debug(`Transcript fetched via yt-dlp for ${videoId} in language: ${lang}`);
          return text;
        }
      }
      throw new PermanentError(`yt-dlp: no subtitles found for ${videoId}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /**
   * Query available subtitle languages for a video via yt-dlp --dump-json.
   * @param {string} videoId
   * @returns {{ manual: string[], auto: string[] }}
   */
  _getAvailableLangs(videoId) {
    return new Promise((resolve, reject) => {
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      const args = ['--dump-json', '--skip-download', '--no-warnings', '--no-progress', url];
      execFile(this._ytDlpBin, args, { timeout: 60000 }, (err, stdout) => {
        if (err) {
          // Detect upcoming/active live events; throw a non-permanent error so the
          // video ID is not permanently blocked — once the stream ends, it can be retried.
          if (err.message?.includes('live event') || err.stderr?.includes('live event')) {
            return reject(new Error(`live event: transcript not yet available for ${videoId}`));
          }
          return reject(err);
        }
        try {
          const info = JSON.parse(stdout);
          resolve({
            manual: Object.keys(info.subtitles || {}),
            auto: Object.keys(info.automatic_captions || {}),
          });
        } catch (parseErr) {
          reject(new Error(`Failed to parse yt-dlp JSON: ${parseErr.message}`));
        }
      });
    });
  }

  /**
   * Pick the best subtitle language from available lists.
   * If manual subtitles exist, pick by TRANSCRIPT_LANG_PRIORITY.
   * If no manual subtitles match, fall back to the original English ASR
   * ('en-orig' preferred, then 'en') to avoid machine-translated auto captions.
   * @param {string[]} manualLangs
   * @param {string[]} autoLangs
   * @returns {string|null}
   */
  _pickBestLang(manualLangs, autoLangs) {
    for (const lang of TRANSCRIPT_LANG_PRIORITY) {
      if (manualLangs.includes(lang)) return lang;
    }
    // No manual subtitles — use original English ASR instead of machine-translated auto captions
    if (autoLangs.includes('en-orig')) return 'en-orig';
    if (autoLangs.includes('en')) return 'en';
    return null;
  }

  /**
   * Run yt-dlp to download subtitles for a video.
   * Downloads only the specified language to minimize HTTP requests.
   * @param {string} videoId
   * @param {string} outputDir
   * @param {string} subLang - Single language code to download
   */
  _runYtDlp(videoId, outputDir, subLang) {
    return new Promise((resolve, reject) => {
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      const args = [
        '--write-sub', '--write-auto-sub',
        '--sub-lang', subLang,
        '--sub-format', 'vtt',
        '--skip-download', '--no-warnings', '--no-progress',
        '-o', path.join(outputDir, 'sub'),
        url,
      ];
      execFile(this._ytDlpBin, args, { timeout: 60000 }, (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve(stdout);
      });
    });
  }

  /**
   * Pick the best VTT file from a list based on TRANSCRIPT_LANG_PRIORITY.
   */
  _pickBestVtt(files) {
    for (const lang of TRANSCRIPT_LANG_PRIORITY) {
      const match = files.find(f => f.includes(`.${lang}.`));
      if (match) return match;
    }
    return null;
  }

  /**
   * Parse VTT subtitle text into plain text.
   * Strips timestamps, headers, and duplicate lines.
   */
  _parseVTT(vtt) {
    const lines = vtt.split('\n');
    const textLines = [];
    const seen = new Set();
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip VTT headers, timestamp lines, and empty lines
      if (!trimmed || trimmed === 'WEBVTT' || trimmed.startsWith('Kind:') ||
          trimmed.startsWith('Language:') || trimmed.includes('-->') ||
          /^NOTE\b/.test(trimmed) || /^\d+$/.test(trimmed)) {
        continue;
      }
      // Strip HTML tags (e.g. <c>, </c>, <font>)
      const clean = trimmed.replace(/<[^>]+>/g, '').trim();
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        textLines.push(clean);
      }
    }
    return textLines.join(' ');
  }

  /**
   * Resolve channel URL to channel ID.
   * Fetches the channel page and extracts the channel ID from meta tags.
   */
  async _resolveChannelId(channelUrl) {
    try {
      const resp = await axios.get(channelUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 15000,
      });
      const html = resp.data;
      // Prefer canonical link — unambiguous even when multiple channelIds appear in page JSON
      const canonical = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)"/);
      if (canonical) return canonical[1];
      // Fallback: look for channel ID in JSON embedded in page
      const match = html.match(/(?:"channelId"|"externalId"):"(UC[a-zA-Z0-9_-]+)"/);
      if (match) return match[1];
      return null;
    } catch (err) {
      this.logger.error(`Failed to resolve channel ID for ${channelUrl}: ${err.message}`);
      return null;
    }
  }

  _extractVideoId(url) {
    const match = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    const shorts = url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    if (shorts) return shorts[1];
    return url;
  }
}

module.exports = YouTubeFetcher;
module.exports.PermanentError = PermanentError;
