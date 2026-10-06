import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPinterestImageFallback,
  buildPinterestResponse,
  isPinterestUrl,
  pinterestResolveError,
} from './pinterest.js';

test('accepts Pinterest pin links and short share links', () => {
  assert.equal(isPinterestUrl('https://www.pinterest.com/pin/123456789012345/'), true);
  assert.equal(isPinterestUrl('https://pinterest.co.uk/pin/123456789012345/'), true);
  assert.equal(isPinterestUrl('https://pin.it/AbC123'), true);
});

test('rejects non-pin pages, insecure links, and lookalike hosts', () => {
  assert.equal(isPinterestUrl('https://www.pinterest.com/creator/board/'), false);
  assert.equal(isPinterestUrl('http://www.pinterest.com/pin/123456789/'), false);
  assert.equal(isPinterestUrl('https://pinterest.com.attacker.example/pin/123456789/'), false);
  assert.equal(isPinterestUrl('https://pin.it.attacker.example/AbC123'), false);
});

test('maps video qualities to the shared response shape', () => {
  const response = buildPinterestResponse({
    id: '123456789',
    title: 'A Pin Video',
    uploader: 'creator',
    thumbnail: 'https://i.pinimg.com/thumbnail.jpg',
    formats: [
      {
        format_id: 'sd',
        url: 'https://v.pinimg.com/video-sd.mp4',
        ext: 'mp4',
        vcodec: 'avc1',
        acodec: 'mp4a',
        height: 480,
        filesize: 1000,
      },
      {
        format_id: 'hd',
        url: 'https://v.pinimg.com/video-hd.mp4',
        ext: 'mp4',
        vcodec: 'avc1',
        acodec: 'mp4a',
        height: 720,
        filesize: 2000,
      },
    ],
  }, 'https://www.pinterest.com/pin/123456789/');

  assert.equal(response.platform, 'pinterest');
  assert.equal(response.title, 'A Pin Video');
  assert.equal(response.author, 'creator');
  assert.equal(response.items.length, 3);
  assert.equal(response.items[0].quality, '720p');
  assert.equal(response.items[0].recommended, true);
  assert.equal(response.items[0].headers.Referer, 'https://www.pinterest.com/');
  assert.equal(response.items[2].kind, 'image');
});

test('adds a separate image download option for a video Pin thumbnail', () => {
  const response = buildPinterestResponse({
    id: 'video-pin',
    title: 'Pin With Cover',
    thumbnail: 'https://i.pinimg.com/736x/ab/cd/ef/cover.jpg',
    formats: [{
      format_id: 'video',
      url: 'https://v.pinimg.com/video.mp4',
      ext: 'mp4',
      vcodec: 'avc1',
      acodec: 'mp4a',
      height: 720,
    }],
  }, 'https://www.pinterest.com/pin/123456789/');

  const imageItem = response.items.find((item) => item.kind === 'image');
  assert.ok(imageItem);
  assert.equal(imageItem.url, 'https://i.pinimg.com/originals/ab/cd/ef/cover.jpg');
  assert.equal(imageItem.filename, 'Pin_With_Cover_1_image.jpg');
  assert.equal(imageItem.mimeType, 'image/jpeg');
  assert.equal(imageItem.quality, 'Original');
  assert.equal(imageItem.recommended, false);
});

test('chooses the largest Pinterest image and upgrades resized CDN URLs to originals', () => {
  const response = buildPinterestResponse({
    id: 'image-pin',
    title: 'Tall Pin',
    thumbnails: [
      {
        url: 'https://i.pinimg.com/236x/aa/bb/cc/pin.jpg',
        width: 236,
        height: 354,
      },
      {
        url: 'https://i.pinimg.com/736x/aa/bb/cc/pin.jpg',
        width: 736,
        height: 1104,
      },
    ],
  }, 'https://www.pinterest.com/pin/123456789/');

  assert.equal(response.items.length, 1);
  assert.equal(response.items[0].kind, 'image');
  assert.equal(response.items[0].url, 'https://i.pinimg.com/originals/aa/bb/cc/pin.jpg');
  assert.equal(response.items[0].quality, 'Original');
  assert.equal(response.items[0].recommended, true);
});

test('falls back to Pinterest page metadata and resolves an image-only Pin', () => {
  const response = buildPinterestImageFallback(
    `<html><head>
      <meta property="og:title" content="Krishna &amp; Radha">
      <meta content="https://i.pinimg.com/736x/8a/e9/9d/image.jpg" name="og:image">
      <meta property="og:image:width" content="736">
      <meta property="og:image:height" content="1308">
    </head></html>`,
    'https://www.pinterest.com/pin/1093108140841597025/',
  );

  assert.equal(response.platform, 'pinterest');
  assert.equal(response.title, 'Krishna & Radha');
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0].kind, 'image');
  assert.equal(response.items[0].url, 'https://i.pinimg.com/originals/8a/e9/9d/image.jpg');
  assert.equal(response.items[0].quality, 'Original');
});

test('rejects missing or non-Pinterest image metadata in the image-only fallback', () => {
  assert.throws(
    () => buildPinterestImageFallback('<html><head></head></html>', 'https://www.pinterest.com/pin/123456789/'),
    /did not expose an image/,
  );
  assert.throws(
    () => buildPinterestImageFallback(
      '<meta property="og:image" content="https://attacker.example/image.jpg">',
      'https://www.pinterest.com/pin/123456789/',
    ),
    /unsupported image source/,
  );
});

test('includes an audio download option when yt-dlp exposes a separate audio stream', () => {
  const response = buildPinterestResponse({
    id: '123456789',
    title: 'A Pin Video',
    formats: [
      {
        format_id: 'video',
        url: 'https://v.pinimg.com/video.m3u8',
        ext: 'mp4',
        vcodec: 'avc1',
        acodec: 'none',
        height: 720,
        protocol: 'm3u8_native',
      },
      {
        format_id: 'audio',
        url: 'https://v.pinimg.com/audio.m3u8',
        ext: 'mp4',
        audio_ext: 'mp4',
        vcodec: 'none',
        acodec: null,
        abr: 0,
        protocol: 'm3u8_native',
      },
    ],
  }, 'https://www.pinterest.com/pin/123456789/');

  assert.equal(response.items.length, 2);
  assert.equal(response.items[0].kind, 'video');
  assert.equal(response.items[0].mimeType, 'video/mp4');
  assert.equal(response.items[0].headers.Referer, undefined);
  const mergedVideoUrl = new URL(response.items[0].url);
  assert.equal(mergedVideoUrl.pathname, '/api/pinterest/download');
  assert.equal(mergedVideoUrl.searchParams.get('videoFormatId'), 'video');
  assert.equal(mergedVideoUrl.searchParams.get('audioFormatId'), 'audio');
  assert.equal(mergedVideoUrl.searchParams.get('filename'), 'A_Pin_Video_1_720p.mp4');
  assert.equal(response.items[1].kind, 'audio');
  assert.equal(response.items[1].filename, 'A_Pin_Video_1_audio.m4a');
  assert.equal(response.items[1].mimeType, 'audio/mp4');
  const audioUrl = new URL(response.items[1].url);
  assert.equal(audioUrl.pathname, '/api/pinterest/download');
  assert.equal(audioUrl.searchParams.get('audioFormatId'), 'audio');
});

test('turns yt-dlp format failures into app-specific messages', () => {
  const error = pinterestResolveError(
    'ERROR: [Pinterest] 123: No video formats found!; please report this issue on yt-dlp issues',
    1,
  );

  assert.match(error.message, /Pinterest couldn't provide downloadable media/);
  assert.doesNotMatch(error.message, /report this issue|github\.com\/yt-dlp/i);
});

test('maps galleries and reports missing downloadable media', () => {
  const response = buildPinterestResponse({
    id: 'gallery',
    entries: [
      { id: 'image-1', url: 'https://i.pinimg.com/originals/photo.jpg', ext: 'jpg' },
      { id: 'image-2', url: 'https://i.pinimg.com/originals/other.webp', ext: 'webp' },
    ],
  }, 'https://www.pinterest.com/pin/123456789/');

  assert.equal(response.items.length, 2);
  assert.equal(response.items[0].kind, 'image');
  assert.equal(response.items[0].mimeType, 'image/jpeg');
  assert.equal(response.items[1].mimeType, 'image/webp');

  assert.throws(
    () => buildPinterestResponse({ id: 'empty' }, 'https://www.pinterest.com/pin/123456789/'),
    /No downloadable media/,
  );
});
