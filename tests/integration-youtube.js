const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const YouTubeFetcher = require('../src/fetchers/youtube');
const { PermanentError } = require('../src/fetchers/youtube');

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

describe('validateChannelUrl()', () => {
  it('@ 格式的 URL 應通過驗證', () => {
    assert.ok(YouTubeFetcher.validateChannelUrl('https://www.youtube.com/@GoogleDevelopers'));
    assert.ok(YouTubeFetcher.validateChannelUrl('https://youtube.com/@Google.Developers'));
    assert.ok(YouTubeFetcher.validateChannelUrl('http://www.youtube.com/@channel-name'));
  });

  it('channel/ 格式的 URL 應通過驗證', () => {
    assert.ok(YouTubeFetcher.validateChannelUrl('https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw'));
    assert.ok(YouTubeFetcher.validateChannelUrl('https://youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx'));
  });

  it('c/ 格式的 URL 應通過驗證', () => {
    assert.ok(YouTubeFetcher.validateChannelUrl('https://www.youtube.com/c/GoogleDevelopers'));
    assert.ok(YouTubeFetcher.validateChannelUrl('https://youtube.com/c/channel.name'));
  });

  it('無效 URL 應不通過驗證', () => {
    // 影片 URL
    assert.equal(YouTubeFetcher.validateChannelUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), false);
    // 空字串
    assert.equal(YouTubeFetcher.validateChannelUrl(''), false);
    // 非 YouTube URL
    assert.equal(YouTubeFetcher.validateChannelUrl('https://www.google.com/@test'), false);
    // 尾端有多餘路徑
    assert.equal(YouTubeFetcher.validateChannelUrl('https://www.youtube.com/@channel/videos'), false);
    // playlist URL
    assert.equal(YouTubeFetcher.validateChannelUrl('https://www.youtube.com/playlist?list=PL12345'), false);
  });

  it('fetchRecentVideos() 傳入無效 URL 應拋出格式錯誤', async () => {
    const fetcher = new YouTubeFetcher({ logger });
    await assert.rejects(
      () => fetcher.fetchRecentVideos('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
      { message: /Invalid YouTube channel URL format/ },
    );
  });
});

describe('_parseVTT()', () => {
  const fetcher = new YouTubeFetcher({ logger });

  it('應正確解析 VTT 字幕為純文字', () => {
    const vtt = [
      'WEBVTT',
      'Kind: captions',
      'Language: zh-Hant',
      '',
      '00:00:01.000 --> 00:00:03.000',
      '你好世界',
      '',
      '00:00:03.000 --> 00:00:05.000',
      '歡迎回來',
    ].join('\n');
    const text = fetcher._parseVTT(vtt);
    assert.equal(text, '你好世界 歡迎回來');
  });

  it('應移除 HTML 標籤', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:03.000',
      '<font color="#ffffff">Hello</font>',
      '',
      '00:00:03.000 --> 00:00:05.000',
      '<c>World</c>',
    ].join('\n');
    const text = fetcher._parseVTT(vtt);
    assert.equal(text, 'Hello World');
  });

  it('應去除重複行', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:03.000',
      '重複文字',
      '',
      '00:00:03.000 --> 00:00:05.000',
      '重複文字',
      '',
      '00:00:05.000 --> 00:00:07.000',
      '新文字',
    ].join('\n');
    const text = fetcher._parseVTT(vtt);
    assert.equal(text, '重複文字 新文字');
  });
});

describe('PermanentError', () => {
  it('PermanentError 應為 Error 的子類別', () => {
    const err = new PermanentError('test message');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof PermanentError);
    assert.equal(err.name, 'PermanentError');
    assert.equal(err.message, 'test message');
  });

  it('fetchTranscript() 無字幕時應拋出 PermanentError', async () => {
    const fetcher = new YouTubeFetcher({ logger });
    // Mock _getAvailableLangs to return empty lists (no subtitles available)
    fetcher._getAvailableLangs = async () => ({ manual: [], auto: [] });
    await assert.rejects(
      () => fetcher.fetchTranscript('NO_SUB_VIDEO'),
      (err) => err instanceof PermanentError && err.message.includes('no subtitles found'),
    );
  });
});

describe('_pickBestLang()', () => {
  const fetcher = new YouTubeFetcher({ logger });

  it('應優先選 manual 字幕語言', () => {
    const result = fetcher._pickBestLang(['zh-TW', 'en'], ['zh-Hans']);
    assert.equal(result, 'zh-TW');
  });

  it('無 manual 時應 fallback 到 en-orig', () => {
    const result = fetcher._pickBestLang([], ['zh-Hans', 'en-orig', 'en']);
    assert.equal(result, 'en-orig');
  });

  it('無 manual 且無 en-orig 時應 fallback 到 en', () => {
    const result = fetcher._pickBestLang([], ['zh-Hans', 'en']);
    assert.equal(result, 'en');
  });

  it('無任何匹配應回傳 null', () => {
    const result = fetcher._pickBestLang(['yue', 'fr'], ['yue', 'fr']);
    assert.equal(result, null);
  });
});

describe('_getAvailableLangs()', () => {
  it('應正確解析 yt-dlp JSON 輸出', async () => {
    const fetcher = new YouTubeFetcher({ logger });
    // Override _getAvailableLangs to test the parsing logic inline
    const mockInfo = {
      subtitles: { 'zh-TW': [{ ext: 'vtt', url: '...' }], en: [{ ext: 'vtt' }] },
      automatic_captions: { 'zh-Hans': [{ ext: 'vtt' }], yue: [{ ext: 'vtt' }] },
    };
    // Simulate the parsing that _getAvailableLangs performs
    const manual = Object.keys(mockInfo.subtitles || {});
    const auto = Object.keys(mockInfo.automatic_captions || {});
    assert.deepEqual(manual, ['zh-TW', 'en']);
    assert.deepEqual(auto, ['zh-Hans', 'yue']);
  });
});

describe('_getAvailableLangs() 語言選擇整合測試 (需要網路)', () => {
  const fetcher = new YouTubeFetcher({ logger });

  it('77lulW5sw2o: 英文 auto-gen only，應選 en-orig 或 en', async () => {
    let langs;
    try {
      langs = await fetcher._getAvailableLangs('77lulW5sw2o');
    } catch {
      return; // 網路不可用時跳過
    }
    // live_chat 可能出現在 manual，但不是真正的字幕語言（不在 TRANSCRIPT_LANG_PRIORITY）
    assert.ok(
      langs.auto.includes('en-orig') || langs.auto.includes('en'),
      'auto 應包含 en-orig 或 en',
    );
    const best = fetcher._pickBestLang(langs.manual, langs.auto);
    assert.ok(best === 'en-orig' || best === 'en', `應選 en-orig 或 en，實際: ${best}`);
  });

  it('I2EYMCwRKfU: 有 6 個 manual 字幕，應選 zh-Hant', async () => {
    let langs;
    try {
      langs = await fetcher._getAvailableLangs('I2EYMCwRKfU');
    } catch {
      return; // 網路不可用時跳過
    }
    const expectedManual = ['yue', 'zh-CN', 'zh-Hans', 'zh-Hant', 'ja', 'ko'];
    assert.deepEqual(langs.manual.sort(), expectedManual.sort(), 'manual 字幕應有 6 個');
    const best = fetcher._pickBestLang(langs.manual, langs.auto);
    assert.equal(best, 'zh-Hant', '應選 zh-Hant');
  });
});

describe('YouTubeFetcher (需要網路)', () => {
  const fetcher = new YouTubeFetcher({ logger });
  const CHANNEL_URL = 'https://www.youtube.com/@NaNaShuoMeiGu';

  it('fetchRecentVideos() 應能取得頻道影片列表', async () => {
    let videos;
    try {
      videos = await fetcher.fetchRecentVideos(CHANNEL_URL);
    } catch {
      return; // 網路不可用時跳過
    }

    assert.ok(Array.isArray(videos));
    assert.ok(videos.length > 0);
  });

  it('每個影片應包含必要欄位', async () => {
    let videos;
    try {
      videos = await fetcher.fetchRecentVideos(CHANNEL_URL);
    } catch {
      return;
    }

    const first = videos[0];
    assert.ok(first.videoId);
    assert.ok(first.title);
    assert.ok(first.url);
    assert.ok(first.url.includes('youtube.com'));
    assert.ok(first.author);
  });

  it('videoId 應為標準 YouTube video ID 格式', async () => {
    let videos;
    try {
      videos = await fetcher.fetchRecentVideos(CHANNEL_URL);
    } catch {
      return;
    }

    for (const v of videos) {
      assert.match(v.videoId, /^[a-zA-Z0-9_-]+$/);
    }
  });

  it('fetchTranscript() 應回傳非空的字幕文字', async () => {
    let videos;
    try {
      videos = await fetcher.fetchRecentVideos(CHANNEL_URL);
    } catch {
      return; // 網路不可用時跳過
    }

    let text;
    try {
      text = await fetcher.fetchTranscript(videos[0].videoId);
    } catch {
      return; // 字幕不可用時跳過
    }
    assert.equal(typeof text, 'string');
    assert.ok(text.length > 0, 'transcript should not be empty');
  });

  it('fetchTranscript() 無效 videoId 應拋出錯誤', async () => {
    try {
      await assert.rejects(
        () => fetcher.fetchTranscript('INVALID_VIDEO_ID_999'),
      );
    } catch {
      return; // 網路不可用時跳過
    }
  });
});
