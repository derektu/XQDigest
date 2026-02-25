'use strict';
/**
 * YouTube Fetcher Integration Tests
 *
 * 這些測試使用真實網路請求，驗證 fetchRecentVideosByYtDlp() 與
 * fetchRecentVideosCombined() 在不同頻道行為下的容錯能力。
 *
 * 測試頻道說明：
 *
 * C05 猴哥財經 (@猴哥财经)
 *   - 頻道有大量「會員限定」影片混在一般影片中
 *   - yt-dlp 抓取時，會員影片會輸出 ERROR，導致 exit code = 1
 *   - 但同時 stdout 仍包含免費影片的 JSON
 *   - 預期：fetchRecentVideosByYtDlp() 應回傳免費影片（partial results），不應因 exit code != 0 而拋出錯誤
 *
 * C08 Amy說美股 (@致富學院Amy說美股)
 *   - 類似 C05，混有會員限定與免費影片
 *   - yt-dlp exit code = 1，但 stdout 有部分免費影片 JSON
 *   - 預期：同 C05，應回傳免費影片
 *
 * E41 Waveform (@Waveform)
 *   - 高流量英語科技頻道，yt-dlp 抓取時某些影片觸發 HTTP 403 / fragment error
 *   - 錯誤訊息：[download] Got error: HTTP Error 403 / ERROR: fragment 1 not found
 *   - 但 stdout 在 403 發生前已輸出多筆影片 JSON（實測有 5 筆）
 *   - 預期：fetchRecentVideosCombined() 應回傳影片（yt-dlp partial + RSS 補充）
 *
 * E34 The Compound (@TheCompoundNews)
 *   - 財經英語頻道，與 E41 相同的 403/fragment 問題
 *   - 預期：同 E41
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const YouTubeFetcher = require('../src/fetchers/youtube');

// 網路測試共用的 graceful skip 邏輯
function isNetworkError(err) {
  return err.code === 'ENOENT' || err.message?.includes('network') || err.message?.includes('timed out');
}

// ── fetchRecentVideosByYtDlp() partial result recovery ──────────────────────

describe('Integration: fetchRecentVideosByYtDlp() — partial result recovery', () => {
  /**
   * C05 猴哥財經
   * 行為：會員限定影片使 yt-dlp exit code = 1，但 stdout 有免費影片 JSON
   * 預期：回傳 > 0 筆免費影片，不拋出錯誤
   */
  it('C05 猴哥財經：有會員影片導致 exit code != 0，仍應回傳免費影片', async () => {
    const fetcher = new YouTubeFetcher();
    try {
      const videos = await fetcher.fetchRecentVideosByYtDlp(
        'https://www.youtube.com/@%E7%8C%B4%E5%93%A5%E8%B4%A2%E7%BB%8F', 20
      );
      assert.ok(Array.isArray(videos), '應回傳陣列');
      assert.ok(videos.length > 0, '應有至少一筆免費影片');
      for (const v of videos) {
        assert.ok(v.videoId, 'videoId 應存在');
        assert.ok(v.url?.includes('youtube.com'), 'url 應為 YouTube 連結');
      }
    } catch (err) {
      if (isNetworkError(err)) return;
      throw err;
    }
  });

  /**
   * C08 Amy說美股
   * 行為：同 C05，混有會員限定與免費影片，yt-dlp exit code = 1
   * 預期：回傳 > 0 筆免費影片，不拋出錯誤
   */
  it('C08 Amy說美股：有會員影片但也有免費影片，應回傳免費部分', async () => {
    const fetcher = new YouTubeFetcher();
    try {
      const videos = await fetcher.fetchRecentVideosByYtDlp(
        'https://www.youtube.com/@%E8%87%B4%E5%AF%8C%E5%AD%A6%E9%99%A2Amy%E8%AF%B4%E7%BE%8E%E8%82%A1', 20
      );
      assert.ok(Array.isArray(videos), '應回傳陣列');
      assert.ok(videos.length > 0, '應有至少一筆免費影片');
      for (const v of videos) {
        assert.ok(v.videoId, 'videoId 應存在');
        assert.ok(v.url?.includes('youtube.com'), 'url 應為 YouTube 連結');
      }
    } catch (err) {
      if (isNetworkError(err)) return;
      throw err;
    }
  });
});

// ── fetchRecentVideosCombined() — 403 / fragment error channels ──────────────

describe('Integration: fetchRecentVideosCombined() — 403 fragment error channels', () => {
  /**
   * E41 Waveform
   * 行為：yt-dlp 抓取時觸發 HTTP 403 / fragment 1 not found，
   *       但在錯誤發生前 stdout 已有影片 JSON（實測 5 筆）
   * 預期：combined 應回傳 > 0 筆影片（yt-dlp partial + RSS 補充）
   *       結果中不應有重複 videoId
   */
  it('E41 Waveform：yt-dlp 403 fragment error，combined 應回傳影片', async () => {
    const fetcher = new YouTubeFetcher();
    try {
      const videos = await fetcher.fetchRecentVideosCombined(
        'https://www.youtube.com/@Waveform', 20
      );
      assert.ok(Array.isArray(videos), '應回傳陣列');
      assert.ok(videos.length > 0, '應有至少一筆影片');
      const ids = videos.map(v => v.videoId);
      assert.equal(ids.length, new Set(ids).size, '不應有重複 videoId');
      for (const v of videos) {
        assert.ok(v.videoId, 'videoId 應存在');
        assert.ok(v.title, 'title 應存在');
        assert.ok(v.url?.includes('youtube.com'), 'url 應為 YouTube 連結');
      }
    } catch (err) {
      if (isNetworkError(err)) return;
      throw err;
    }
  });

  /**
   * E34 The Compound
   * 行為：同 E41，財經頻道，yt-dlp 403/fragment error
   * 預期：combined 應回傳 > 0 筆影片，不應有重複 videoId
   */
  it('E34 The Compound：yt-dlp 403 fragment error，combined 應回傳影片', async () => {
    const fetcher = new YouTubeFetcher();
    try {
      const videos = await fetcher.fetchRecentVideosCombined(
        'https://www.youtube.com/@TheCompoundNews', 20
      );
      assert.ok(Array.isArray(videos), '應回傳陣列');
      assert.ok(videos.length > 0, '應有至少一筆影片');
      const ids = videos.map(v => v.videoId);
      assert.equal(ids.length, new Set(ids).size, '不應有重複 videoId');
      for (const v of videos) {
        assert.ok(v.videoId, 'videoId 應存在');
        assert.ok(v.title, 'title 應存在');
        assert.ok(v.url?.includes('youtube.com'), 'url 應為 YouTube 連結');
      }
    } catch (err) {
      if (isNetworkError(err)) return;
      throw err;
    }
  });
});
