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
  static CHANNEL_URL_PATTERN = /^https?:\/\/(?:www\.)?youtube\.com\/(?:@[\w.-]+|channel\/UC[\w-]+|c\/[\w.-]+)\/?$/;

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

    return feed.items.map(item => ({
      videoId: this._extractVideoId(item.link),
      title: item.title,
      publishedDate: item.pubDate || item.isoDate,
      url: item.link,
      author: feed.title,
    }));
  }

  /**
   * Download transcript for a YouTube video using yt-dlp.
   * Downloads both manual and auto-generated subtitles in a single call,
   * then picks the best available language from TRANSCRIPT_LANG_PRIORITY.
   * @param {string} videoId
   * @returns {string} Full transcript text
   */
  async fetchTranscript(videoId) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-sub-'));
    try {
      await this._runYtDlp(videoId, tmpDir);
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
   * Run yt-dlp to download subtitles for a video.
   * Uses both --write-subs (manual/finalized) and --write-auto-sub (live ASR),
   * requesting all preferred languages in one call.
   */
  _runYtDlp(videoId, outputDir) {
    return new Promise((resolve, reject) => {
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      const args = [
        '--write-sub', '--write-auto-sub',
        '--sub-lang', TRANSCRIPT_LANG_PRIORITY.join(','),
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
      // Look for channel ID in meta tag or page content
      const match = html.match(/(?:"channelId"|"externalId"):"(UC[a-zA-Z0-9_-]+)"/);
      if (match) return match[1];
      // Fallback: look in canonical link
      const canonical = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)"/);
      if (canonical) return canonical[1];
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
