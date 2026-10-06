import assert from 'node:assert/strict';
import test from 'node:test';

import { isPinterestImageUrl } from './pinterest-image.js';

test('accepts HTTPS Pinterest CDN image URLs', () => {
  assert.equal(
    isPinterestImageUrl('https://i.pinimg.com/originals/8a/e9/9d/image.jpg'),
    true,
  );
  assert.equal(
    isPinterestImageUrl('https://i.pinimg.com/736x/8a/e9/9d/image.webp?width=736'),
    true,
  );
});

test('rejects unsafe hosts, schemes, and file types', () => {
  assert.equal(isPinterestImageUrl('http://i.pinimg.com/originals/image.jpg'), false);
  assert.equal(isPinterestImageUrl('https://i.pinimg.com.attacker.example/image.jpg'), false);
  assert.equal(isPinterestImageUrl('https://attacker.example/image.jpg'), false);
  assert.equal(isPinterestImageUrl('https://i.pinimg.com/image.svg'), false);
});
