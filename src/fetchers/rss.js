const RssParser = require('rss-parser');
const crypto = require('crypto');
const Logger = require('../logger');

class RSSFetcher {
  static FEED_URL_PATTERN = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

  /**
   * Validate that a URL has valid HTTP(S) format for an RSS feed.
   * Pure format check, no network request.
   * @param {string} url
   * @returns {boolean}
   */
  static validateFeedUrl(url) {
    return RSSFetcher.FEED_URL_PATTERN.test(url);
  }

  constructor(logger) {
    this.logger = logger || Logger.getLogger('RSSFetcher');
    this.parser = new RssParser({
      timeout: 15000,
    });
  }

  /**
   * Fetch recent items from an RSS feed.
   * @param {string} feedUrl - RSS/Atom feed URL
   * @returns {Array<{itemId, title, content, publishedDate, url, author}>}
   */
  async fetchItems(feedUrl) {
    if (!RSSFetcher.validateFeedUrl(feedUrl)) {
      throw new Error(`Invalid RSS feed URL format: ${feedUrl}`);
    }

    const feed = await this.parser.parseURL(feedUrl);

    return feed.items.map(item => ({
      itemId: this._generateItemId(feedUrl, item),
      title: item.title || 'Untitled',
      content: item['content:encoded'] || item.content || item.contentSnippet || '',
      publishedDate: item.pubDate || item.isoDate || null,
      url: item.link || '',
      author: item.creator || item.author || feed.title || '',
    }));
  }

  _generateItemId(feedUrl, item) {
    const source = item.guid || item.link || item.title || '';
    const hash = crypto.createHash('sha1').update(`${feedUrl}|${source}`).digest('hex');
    return `rss-${hash}`;
  }
}

module.exports = RSSFetcher;
