/**
 * Batch download transcripts for YouTube channels listed in a CSV file.
 *
 * Usage:
 *   node scripts/download-transcripts.js [options]
 *
 * Options:
 *   --csv <path>     CSV file path (default: config/ytchannel.csv)
 *   --ids <ids>      Only process specified channel IDs (comma-separated, e.g. E01,C07)
 *   --days <N>       Only download videos from last N days (default: 30)
 *   --max <M>        Max videos per channel (default: 10)
 *   --output <dir>   Output directory (default: ./transcripts)
 *   --delay <ms>     Delay between downloads in ms (default: 2000)
 *   --help           Show help
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');

const YouTubeFetcher = require('../src/fetchers/youtube');
const { PermanentError } = require('../src/fetchers/youtube');

function showHelp() {
  console.log(`
Usage: node scripts/download-transcripts.js [options]

Options:
  --csv <path>     CSV file path (default: config/ytchannel.csv)
  --ids <ids>      Only process specified channel IDs (comma-separated, e.g. E01,C07)
  --days <N>       Only download videos from last N days (default: 30)
  --max <M>        Max videos per channel (default: 10)
  --output <dir>   Output directory (default: ./transcripts)
  --delay <ms>     Delay between downloads in ms (default: 2000)
  --help           Show help
`);
}

function parseCsv(csvPath) {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n');
  const channels = [];

  for (let i = 1; i < lines.length; i++) { // skip header line
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(',');
    if (parts.length < 3) continue;

    const id = parts[0].trim();
    const name = parts[1].trim();
    // Join remaining parts in case URL contains commas (defensive)
    const url = parts.slice(2).join(',').trim();

    if (id && url) {
      channels.push({ id, name, url });
    }
  }

  return channels;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatMarkdown(channel, video, transcript) {
  const pubDate = new Date(video.publishedDate).toISOString().slice(0, 10);
  const frontmatter = [
    '---',
    `title: "${video.title.replace(/"/g, '\\"')}"`,
    `channel: "${channel.name}"`,
    `channelId: ${channel.id}`,
    `videoId: ${video.videoId}`,
    `url: ${video.url}`,
    `published: ${pubDate}`,
    '---',
  ].join('\n');

  return `${frontmatter}\n\n# ${video.title}\n\n## Transcript\n\n${transcript}\n`;
}

async function main() {
  const { values } = parseArgs({
    options: {
      csv:    { type: 'string',  default: 'config/ytchannel.csv' },
      ids:    { type: 'string' },
      days:   { type: 'string',  default: '30' },
      max:    { type: 'string',  default: '10' },
      output: { type: 'string',  default: './transcripts' },
      delay:  { type: 'string',  default: '2000' },
      help:   { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  const csvPath   = path.resolve(values.csv);
  const daysBack  = parseInt(values.days,  10);
  const maxVideos = parseInt(values.max,   10);
  const outputDir = path.resolve(values.output);
  const delayMs   = parseInt(values.delay, 10);

  if (!fs.existsSync(csvPath)) {
    console.error(`Error: CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  const channels = parseCsv(csvPath);
  if (channels.length === 0) {
    console.error('Error: No channels found in CSV');
    process.exit(1);
  }

  const filterIds = values.ids
    ? values.ids.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  let activeChannels = channels;
  if (filterIds.length > 0) {
    activeChannels = channels.filter(c => filterIds.includes(c.id));
    for (const id of filterIds) {
      if (!channels.find(c => c.id === id)) {
        console.warn(`[WARN] ID not found in CSV: ${id}`);
      }
    }
  }

  console.log(`Found ${channels.length} channels in ${csvPath}${filterIds.length > 0 ? `, processing ${activeChannels.length} (filtered by --ids)` : ''}`);
  console.log(`Settings: days=${daysBack}, max=${maxVideos}, output=${outputDir}, delay=${delayMs}ms`);

  const fetcher = new YouTubeFetcher();
  const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const stats = { total: 0, skipped: 0, success: 0, noSubtitle: 0, failed: 0 };

  for (const channel of activeChannels) {
    console.log(`\n[${channel.id}] ${channel.name}`);

    if (!YouTubeFetcher.validateChannelUrl(channel.url)) {
      console.log(`  [WARN] Invalid channel URL format, skipping: ${channel.url}`);
      continue;
    }

    let videos;
    try {
      // Use combined RSS + yt-dlp — yt-dlp excludes Shorts and provides more videos,
      // RSS supplements if yt-dlp has partial failures (403/fragment errors).
      const maxFetch = Math.min(maxVideos * 5, 50);
      videos = await fetcher.fetchRecentVideosCombined(channel.url, maxFetch);
    } catch (err) {
      console.log(`  [WARN] Failed to fetch video list: ${err.message}`);
      continue;
    }

    // Filter by cutoff date, sort descending, take at most maxVideos
    const filtered = videos
      .filter(v => {
        const pub = new Date(v.publishedDate);
        return !isNaN(pub.getTime()) && pub >= cutoffDate;
      })
      .sort((a, b) => new Date(b.publishedDate) - new Date(a.publishedDate))
      .slice(0, maxVideos);

    console.log(`  ${videos.length} videos fetched, ${filtered.length} within last ${daysBack} days (max ${maxVideos})`);

    const channelDir = path.join(outputDir, channel.id);
    fs.mkdirSync(channelDir, { recursive: true });

    for (const video of filtered) {
      stats.total++;

      const pubDate = new Date(video.publishedDate);
      const dateStr = pubDate.toISOString().slice(0, 10); // YYYY-MM-DD
      const filename = `${dateStr}_${video.videoId}.md`;
      const filePath = path.join(channelDir, filename);

      if (fs.existsSync(filePath)) {
        console.log(`  [SKIP] ${filename}`);
        stats.skipped++;
        continue;
      }

      try {
        const transcript = await fetcher.fetchTranscript(video.videoId);
        const content = formatMarkdown(channel, video, transcript);
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`  [OK]   ${filename} (${transcript.length} chars)`);
        stats.success++;
      } catch (err) {
        if (err instanceof PermanentError || err.permanent) {
          console.log(`  [NO-SUBTITLE] ${filename}`);
          stats.noSubtitle++;
        } else {
          console.log(`  [FAIL] ${filename}: ${err.message}`);
          stats.failed++;
        }
      }

      await sleep(delayMs);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Total:       ${stats.total}`);
  console.log(`Skipped:     ${stats.skipped}`);
  console.log(`Success:     ${stats.success}`);
  console.log(`No subtitle: ${stats.noSubtitle}`);
  console.log(`Failed:      ${stats.failed}`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
