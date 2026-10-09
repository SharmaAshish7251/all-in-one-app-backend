import assert from "node:assert/strict";
import test from "node:test";

import {
    addMissingMediaSizes,
    buildInstagramResponse,
    formatInstagramResolveError,
    getInstagramCookieArgs,
    getInstagramYtDlpArgs,
    isInstagramUrl,
} from "./instagram.js";

test("adds an optional cookies file to Instagram yt-dlp commands", () => {
  const url = "https://www.instagram.com/reel/ABC123/";
  const cookiesFile = "C:/private/instagram-cookies.txt";
  const args = getInstagramYtDlpArgs(url, cookiesFile);

  assert.deepEqual(args.slice(-3), ["--cookies", cookiesFile, url]);
  assert.deepEqual(getInstagramCookieArgs("  "), []);
});

test("explains Instagram anonymous rate-limit and login-redirect errors", () => {
  const details =
    "The webpage request was redirected to the login page. You have exceeded the rate-limit for accessing posts anonymously.";

  assert.match(
    formatInstagramResolveError(details, 1),
    /rate-limiting anonymous requests or requires authentication.*INSTAGRAM_COOKIES_FILE/,
  );
  assert.equal(
    formatInstagramResolveError("Unsupported URL", 1),
    "Could not resolve this Instagram post: Unsupported URL",
  );
});

test("accepts Instagram post and reel links across supported hosts", () => {
  assert.equal(isInstagramUrl("https://www.instagram.com/p/ABC123/"), true);
  assert.equal(isInstagramUrl("https://instagram.com/reel/ABC123/"), true);
  assert.equal(isInstagramUrl("https://instagr.am/tv/ABC123/"), true);
});

test("rejects profiles, stories, and lookalike domains", () => {
  assert.equal(isInstagramUrl("https://www.instagram.com/creator/"), false);
  assert.equal(
    isInstagramUrl("https://www.instagram.com/stories/creator/123/"),
    false,
  );
  assert.equal(
    isInstagramUrl("https://instagram.com.attacker.example/p/ABC123/"),
    false,
  );
  assert.equal(isInstagramUrl("http://www.instagram.com/p/ABC123/"), false);
});

test("maps video qualities and carousel images to the app response shape", () => {
  const response = buildInstagramResponse(
    {
      id: "post-123",
      title: "A public post",
      uploader: "creator",
      entries: [
        {
          id: "video-1",
          formats: [
            {
              format_id: "sd",
              url: "https://cdn.example/video-sd.mp4",
              ext: "mp4",
              vcodec: "avc1",
              acodec: "mp4a",
              height: 480,
              filesize: 1000,
            },
            {
              format_id: "hd",
              url: "https://cdn.example/video-hd.mp4",
              ext: "mp4",
              vcodec: "avc1",
              acodec: "mp4a",
              height: 720,
              filesize: 2000,
            },
          ],
          http_headers: { "User-Agent": "yt-dlp-test" },
        },
        {
          id: "image-2",
          url: "https://cdn.example/image.jpg",
          ext: "jpg",
        },
      ],
    },
    "https://www.instagram.com/p/post-123/",
  );

  assert.equal(response.platform, "instagram");
  assert.equal(response.items.length, 3);
  assert.equal(response.items[0].quality, "720p");
  assert.equal(response.items[0].recommended, true);
  assert.equal(response.items[0].headers["User-Agent"], "yt-dlp-test");
  assert.equal(response.items[0].headers.Referer, "https://www.instagram.com/");
  assert.equal(response.items[0].groupId, "post-123");
  assert.equal(response.items[2].groupId, "post-123");
  assert.equal(response.items[2].kind, "image");
  assert.equal(response.items[2].mimeType, "image/jpeg");
});

test("maps a direct MP4 entry without a formats array", () => {
  const response = buildInstagramResponse(
    {
      id: "post-456",
      ext: "mp4",
      url: "https://cdn.example/video.mp4",
    },
    "https://www.instagram.com/reel/post-456/",
  );

  assert.equal(response.items.length, 1);
  assert.equal(response.items[0].kind, "video");
  assert.equal(response.items[0].url, "https://cdn.example/video.mp4");
});

test("routes separate Instagram video and audio formats through the merge endpoint", () => {
  const response = buildInstagramResponse(
    {
      id: "post-789",
      formats: [
        {
          format_id: "dash-audio_1",
          url: "https://cdn.example/audio.m4a",
          ext: "m4a",
          vcodec: "none",
          acodec: "mp4a.40.5",
        },
        {
          format_id: "dash-video_720",
          url: "https://cdn.example/video.mp4",
          ext: "mp4",
          vcodec: "avc1",
          acodec: "none",
          height: 720,
        },
      ],
    },
    "https://www.instagram.com/reel/post-789/",
    "http://localhost:4000",
  );

  const item = response.items[0];
  const downloadUrl = new URL(item.url);
  assert.equal(downloadUrl.pathname, "/api/instagram/download");
  assert.equal(downloadUrl.searchParams.get("videoFormatId"), "dash-video_720");
  assert.equal(downloadUrl.searchParams.get("audioFormatId"), "dash-audio_1");
  assert.equal(
    downloadUrl.searchParams.get("url"),
    "https://www.instagram.com/reel/post-789/",
  );
  assert.deepEqual(item.headers, {});
});

test("fills a missing file size from the CDN content-length header", async () => {
  const items = [
    {
      url: "https://cdn.example/video.mp4",
      filename: "video.mp4",
      headers: { Referer: "https://www.instagram.com/" },
      sizeBytes: null,
    },
  ];
  let requestOptions;

  await addMissingMediaSizes(items, async (_url, options) => {
    requestOptions = options;
    return new Response(null, {
      status: 200,
      headers: { "content-length": "12345" },
    });
  });

  assert.equal(items[0].sizeBytes, 12345);
  assert.equal(requestOptions.method, "HEAD");
  assert.equal(requestOptions.headers.Referer, "https://www.instagram.com/");
});

test("uses a one-byte range request when HEAD does not report the size", async () => {
  const items = [
    {
      url: "https://cdn.example/photo.jpg",
      filename: "photo.jpg",
      headers: {},
      sizeBytes: null,
    },
  ];
  const methods = [];

  await addMissingMediaSizes(items, async (_url, options) => {
    methods.push(options.method);
    if (options.method === "HEAD") {
      return new Response(null, { status: 405 });
    }
    assert.equal(options.headers.Range, "bytes=0-0");
    return new Response(null, {
      status: 206,
      headers: { "content-range": "bytes 0-0/9876" },
    });
  });

  assert.deepEqual(methods, ["HEAD", "GET"]);
  assert.equal(items[0].sizeBytes, 9876);
});

test("keeps known sizes and leaves size unknown if the CDN provides none", async () => {
  const items = [
    {
      url: "https://cdn.example/known.mp4",
      filename: "known.mp4",
      headers: {},
      sizeBytes: 456,
    },
    {
      url: "https://cdn.example/unknown.mp4",
      filename: "unknown.mp4",
      headers: {},
      sizeBytes: null,
    },
  ];
  let requests = 0;

  await addMissingMediaSizes(items, async () => {
    requests += 1;
    return new Response(null, { status: 200 });
  });

  assert.equal(requests, 2);
  assert.equal(items[0].sizeBytes, 456);
  assert.equal(items[1].sizeBytes, null);
});

test("fails explicitly when metadata contains no downloadable public media", () => {
  assert.throws(
    () =>
      buildInstagramResponse(
        { id: "post-123", entries: [] },
        "https://www.instagram.com/p/post-123/",
      ),
    /Private or login-gated Instagram posts are not supported/,
  );
});
