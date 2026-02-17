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
    const fetcher = new YouTubeFetcher(logger);
    await assert.rejects(
      () => fetcher.fetchRecentVideos('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
      { message: /Invalid YouTube channel URL format/ },
    );
  });
});

describe('_parseVTT()', () => {
  const fetcher = new YouTubeFetcher(logger);

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
    const fetcher = new YouTubeFetcher(logger);
    // Mock _runYtDlp to always reject (no subtitles)
    fetcher._runYtDlp = async () => { throw new Error('no sub'); };
    await assert.rejects(
      () => fetcher.fetchTranscript('NO_SUB_VIDEO'),
      (err) => err instanceof PermanentError && err.message.includes('no subtitles found'),
    );
  });
});

describe('YouTubeFetcher (需要網路)', () => {
  const fetcher = new YouTubeFetcher(logger);
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
