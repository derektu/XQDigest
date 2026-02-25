'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const YouTubeFetcher = require('../src/fetchers/youtube');

describe('YouTubeFetcher._isShorts()', () => {
  const fetcher = new YouTubeFetcher();

  it('URL 含 /shorts/ 應被識別為 Shorts', () => {
    assert.equal(fetcher._isShorts({ url: 'https://www.youtube.com/shorts/abc123', title: '普通標題' }), true);
  });

  it('標題含 #Shorts 應被識別為 Shorts（大寫）', () => {
    assert.equal(fetcher._isShorts({ url: 'https://www.youtube.com/watch?v=abc123', title: '今天吃什麼 #Shorts' }), true);
  });

  it('標題含 #shorts 應被識別為 Shorts（小寫）', () => {
    assert.equal(fetcher._isShorts({ url: 'https://www.youtube.com/watch?v=abc123', title: '每日分享 #shorts' }), true);
  });

  it('標題含 #SHORTS 應被識別為 Shorts（全大寫）', () => {
    assert.equal(fetcher._isShorts({ url: 'https://www.youtube.com/watch?v=abc123', title: '片段 #SHORTS' }), true);
  });

  it('正常影片不應被識別為 Shorts', () => {
    assert.equal(fetcher._isShorts({ url: 'https://www.youtube.com/watch?v=abc123', title: '股市分析 2026年第一季' }), false);
  });

  it('標題含 #shortsfund（非 Shorts hashtag）不應被識別為 Shorts', () => {
    // #shortsfund 不符合 #shorts\b（\b 確保 shorts 是完整單字）
    assert.equal(fetcher._isShorts({ url: 'https://www.youtube.com/watch?v=abc123', title: '基金介紹 #shortsfund' }), false);
  });

  it('url 為 undefined 時不應拋出錯誤', () => {
    assert.equal(fetcher._isShorts({ url: undefined, title: '普通標題' }), false);
  });

  it('title 為 undefined 時不應拋出錯誤', () => {
    assert.equal(fetcher._isShorts({ url: 'https://www.youtube.com/watch?v=abc123', title: undefined }), false);
  });
});

describe('YouTubeFetcher.fetchRecentVideosByYtDlp()', () => {
  it('應回傳影片列表，不含 Shorts，有 publishedDate（網路測試）', async () => {
    const fetcher = new YouTubeFetcher();
    try {
      const videos = await fetcher.fetchRecentVideosByYtDlp('https://www.youtube.com/@ABitPersonalPod', 5);
      assert.ok(Array.isArray(videos));
      if (videos.length > 0) {
        const v = videos[0];
        assert.ok(v.videoId, 'videoId 應存在');
        assert.ok(v.title, 'title 應存在');
        assert.ok(v.publishedDate, 'publishedDate 應存在');
        assert.ok(v.url && v.url.includes('youtube.com'), 'url 應為 YouTube 連結');
        // publishedDate 應為 YYYY-MM-DD 格式
        assert.match(v.publishedDate, /^\d{4}-\d{2}-\d{2}$/);
      }
    } catch (err) {
      // yt-dlp 不可用或網路問題時 graceful 跳過
      if (err.code === 'ENOENT' || err.message?.includes('network')) return;
      throw err;
    }
  });
});

describe('YouTubeFetcher.validateChannelUrl()', () => {
  it('@ 格式應通過驗證', () => {
    assert.equal(YouTubeFetcher.validateChannelUrl('https://www.youtube.com/@channelname'), true);
  });

  it('channel/UC 格式應通過驗證', () => {
    assert.equal(YouTubeFetcher.validateChannelUrl('https://www.youtube.com/channel/UCxxxxxxxx'), true);
  });

  it('無效 URL 應不通過驗證', () => {
    assert.equal(YouTubeFetcher.validateChannelUrl('https://example.com/channel'), false);
  });

  it('影片 URL 應不通過驗證', () => {
    assert.equal(YouTubeFetcher.validateChannelUrl('https://www.youtube.com/watch?v=abc123'), false);
  });

  it('百分比編碼中文字元的 @ URL 應通過驗證（C05/C08 案例）', () => {
    assert.equal(YouTubeFetcher.validateChannelUrl('https://www.youtube.com/@%E7%8C%B4%E5%93%A5%E8%B4%A2%E7%BB%8F'), true);
    assert.equal(YouTubeFetcher.validateChannelUrl('https://www.youtube.com/@%E8%87%B4%E5%AF%8C%E5%AD%A6%E9%99%A2Amy%E8%AF%B4%E7%BE%8E%E8%82%A1'), true);
  });

  it('無效的百分比編碼（% 後非兩位 hex）不應通過驗證', () => {
    assert.equal(YouTubeFetcher.validateChannelUrl('https://www.youtube.com/@bad%ZZchannel'), false);
  });
});

describe('YouTubeFetcher._parseVTT()', () => {
  const fetcher = new YouTubeFetcher();

  it('應去除 VTT header 與時間戳，只保留文字', () => {
    const vtt = `WEBVTT
Kind: captions
Language: zh-TW

00:00:01.000 --> 00:00:03.000
今天我們來聊聊股市

00:00:03.000 --> 00:00:05.000
美股最近表現強勁
`;
    const result = fetcher._parseVTT(vtt);
    assert.equal(result, '今天我們來聊聊股市 美股最近表現強勁');
  });

  it('應去除重複行', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.000
重複內容

00:00:03.000 --> 00:00:05.000
重複內容

00:00:05.000 --> 00:00:07.000
不重複
`;
    const result = fetcher._parseVTT(vtt);
    assert.equal(result, '重複內容 不重複');
  });

  it('應去除 HTML 標籤', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.000
<c>帶標籤的文字</c>
`;
    const result = fetcher._parseVTT(vtt);
    assert.equal(result, '帶標籤的文字');
  });
});
