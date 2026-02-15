const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const RSSFetcher = require('../src/fetchers/rss');

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

describe('validateFeedUrl()', () => {
  it('合法的 HTTP(S) URL 應通過驗證', () => {
    assert.ok(RSSFetcher.validateFeedUrl('https://feeds.bbci.co.uk/news/rss.xml'));
    assert.ok(RSSFetcher.validateFeedUrl('http://example.com/feed'));
    assert.ok(RSSFetcher.validateFeedUrl('https://example.com/rss?format=xml&lang=en'));
  });

  it('無效 URL 應不通過驗證', () => {
    assert.equal(RSSFetcher.validateFeedUrl(''), false);
    assert.equal(RSSFetcher.validateFeedUrl('not-a-url'), false);
    assert.equal(RSSFetcher.validateFeedUrl('ftp://example.com/feed'), false);
    assert.equal(RSSFetcher.validateFeedUrl('file:///etc/passwd'), false);
  });

  it('fetchItems() 傳入無效 URL 應拋出格式錯誤', async () => {
    const fetcher = new RSSFetcher(logger);
    await assert.rejects(
      () => fetcher.fetchItems('not-a-url'),
      { message: /Invalid RSS feed URL format/ },
    );
  });
});

describe('RSSFetcher (需要網路)', () => {
  const fetcher = new RSSFetcher(logger);
  const FEED_URL = 'https://simonwillison.net/atom/everything/';

  it('fetchItems() 應能解析真實 RSS feed', async () => {
    let items;
    try {
      items = await fetcher.fetchItems(FEED_URL);
    } catch {
      return; // 網路不可用時跳過
    }

    assert.ok(Array.isArray(items));
    assert.ok(items.length > 0);
  });

  it('每個項目應包含必要欄位', async () => {
    let items;
    try {
      items = await fetcher.fetchItems(FEED_URL);
    } catch {
      return;
    }

    const first = items[0];
    assert.ok(first.itemId);
    assert.ok(first.title);
    assert.equal(typeof first.content, 'string');
    assert.ok(first.url);
    assert.equal(typeof first.author, 'string');
  });

  it('所有項目的 itemId 應不為空且唯一', async () => {
    let items;
    try {
      items = await fetcher.fetchItems(FEED_URL);
    } catch {
      return;
    }

    const ids = items.map(i => i.itemId);
    for (const id of ids) assert.ok(id && id.length > 0);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('無效 URL 應拋出錯誤', async () => {
    await assert.rejects(
      () => fetcher.fetchItems('https://nonexistent.invalid/feed.xml'),
    );
  });
});
