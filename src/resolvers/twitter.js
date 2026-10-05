import axios from 'axios';

/**
 * Check if the given URL belongs to Twitter / X.
 */
export function isTwitterUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const domains = ['twitter.com', 'x.com', 'fxtwitter.com', 'vxtwitter.com'];
    return domains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/**
 * Extract tweet ID from a tweet URL.
 */
function extractTweetId(url) {
  const match = url.match(/(?:twitter\.com|x\.com)\/(?:[^/]+\/status|i\/web\/status)\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Resolve Twitter / X media using fxtwitter API.
 */
export async function resolveTwitter(url) {
  const tweetId = extractTweetId(url);
  if (!tweetId) {
    throw new Error('Could not extract tweet ID from URL');
  }

  const apiUrl = `https://api.fxtwitter.com/status/${tweetId}`;
  let response;
  try {
    response = await axios.get(apiUrl, {
      headers: { 'User-Agent': 'AllInOneDownloaderBackend/1.0' },
      timeout: 15000,
    });
  } catch (err) {
    throw new Error(`fxtwitter API request failed: ${err.message}`);
  }

  const data = response.data;
  if (data.code !== 200 || !data.tweet) {
    throw new Error(data.message || 'Tweet not found or has no public media');
  }

  const tweet = data.tweet;
  const items = [];

  // Videos
  if (tweet.media?.videos && Array.isArray(tweet.media.videos)) {
    const sorted = [...tweet.media.videos].sort(
      (a, b) => (b.variants?.[0]?.bitrate ?? 0) - (a.variants?.[0]?.bitrate ?? 0),
    );

    sorted.forEach((video, i) => {
      const bestVariant = video.variants
        ?.filter((v) => v.content_type === 'video/mp4')
        .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];

      if (bestVariant?.url) {
        items.push({
          id: `tw_video_${tweetId}_${i}`,
          groupId: tweetId,
          kind: 'video',
          url: bestVariant.url,
          headers: {},
          filename: `twitter_${tweetId}.mp4`,
          mimeType: 'video/mp4',
          sizeBytes: null,
          thumbnail: video.thumbnail_url,
          width: video.width,
          height: video.height,
          durationSeconds: video.duration,
          recommended: i === 0,
        });
      }
    });
  }

  // Photos
  if (tweet.media?.photos && Array.isArray(tweet.media.photos)) {
    tweet.media.photos.forEach((photo, i) => {
      const photoUrl = photo.url.includes('?') ? `${photo.url}&name=orig` : `${photo.url}?name=orig`;
      items.push({
        id: `tw_photo_${tweetId}_${i}`,
        groupId: tweetId,
        kind: 'image',
        url: photoUrl,
        headers: {},
        filename: `twitter_${tweetId}_${i + 1}.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: null,
        width: photo.width,
        height: photo.height,
        recommended: i === 0,
      });
    });
  }

  if (items.length === 0) {
    throw new Error('This tweet has no downloadable media');
  }

  return {
    platform: 'twitter',
    sourceUrl: url,
    items,
  };
}
