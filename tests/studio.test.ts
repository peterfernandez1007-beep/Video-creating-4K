import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { decryptSecret, encryptSecret, hashPassword, verifyPassword } from '../server/crypto.js';
import {
  classifyExportQuality,
  createKenBurnsVideo,
  getResolutionDimensions,
  probeMedia,
  TEMP_DIR,
} from '../server/services/ffmpegService.js';
import type { MediaAsset } from '../src/types/studio.js';

test('AES-256-GCM provider secret encryption roundtrip', () => {
  const secret = 'rk_live_test_secret_987654321';
  const encrypted = encryptSecret(secret);
  assert.notEqual(encrypted, secret);
  assert.equal(decryptSecret(encrypted), secret);
});

test('scrypt password hashing and verification', () => {
  const hash = hashPassword('studio4k-secret');
  assert.equal(verifyPassword('studio4k-secret', hash), true);
  assert.equal(verifyPassword('wrong-password', hash), false);
});

test('4K resolution & aspect ratio geometry produces even dimensions', () => {
  const d169 = getResolutionDimensions('2160p', '16:9');
  assert.deepEqual(d169, { width: 3840, height: 2160 });

  const d916 = getResolutionDimensions('2160p', '9:16');
  assert.deepEqual(d916, { width: 2160, height: 3840 });

  const d45 = getResolutionDimensions('1080p', '4:5');
  assert.equal(d45.width % 2, 0);
  assert.equal(d45.height % 2, 0);
});

test('Native 4K vs Upscaled 4K classification never falsely labels 1080p as native 4K', () => {
  const baseAsset: MediaAsset = {
    id: 'm1',
    userId: 'u1',
    projectId: null,
    kind: 'video',
    title: '1080p clip',
    filename: 'clip.mp4',
    mimeType: 'video/mp4',
    url: '/api/media/m1/stream',
    thumbnailUrl: null,
    durationSec: 5,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    isNative4k: false,
    sourceType: 'upload',
    metadata: {},
    createdAt: '',
  };
  assert.equal(classifyExportQuality('2160p', [baseAsset]), 'upscaled_4k');

  const native4kAsset: MediaAsset = { ...baseAsset, width: 3840, height: 2160, isNative4k: true };
  assert.equal(classifyExportQuality('2160p', [native4kAsset]), 'native_4k');
});

test('FFmpeg generates real MP4 video and FFprobe verifies dimensions and FPS', async () => {
  const starterImg = path.resolve(
    process.cwd(),
    'src/assets/images/studio_hero_cinema_1794989743261.jpg'
  );
  assert.equal(fs.existsSync(starterImg), true);

  const outMp4 = path.join(TEMP_DIR, `test_motion_${Date.now()}.mp4`);
  try {
    await createKenBurnsVideo(starterImg, outMp4, {
      width: 1280,
      height: 720,
      durationSec: 2,
      fps: 24,
      motion: 'zoom_in',
    });
    const probed = await probeMedia(outMp4);
    assert.equal(probed.width, 1280);
    assert.equal(probed.height, 720);
    assert.equal(probed.fps, 24);
    assert.ok(probed.durationSec >= 1.8);
  } finally {
    if (fs.existsSync(outMp4)) fs.unlinkSync(outMp4);
  }
});
