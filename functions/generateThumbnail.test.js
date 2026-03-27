/**
 * generateThumbnail Cloud Function 단위 테스트
 *
 * sharp 라이브러리를 이용한 이미지 리사이즈(썸네일 생성) 로직을 검증한다.
 * Firebase Storage 등 외부 의존성은 모두 mock 처리한다.
 */

const assert = require("assert");
const { describe, it, beforeEach } = require("node:test");

// ── Mock 설정 ──────────────────────────────────────────

// sharp는 실제 라이브러리를 사용하여 이미지 변환이 정상 동작하는지 확인
const sharp = require("sharp");

// Firebase Admin / Storage mock
let uploadedBuffer = null;
let uploadedMetadata = null;
let downloadBuffer = null;

const mockFile = (path) => ({
    download: async () => [downloadBuffer],
    save: async (buf, opts) => {
        uploadedBuffer = buf;
        uploadedMetadata = opts.metadata;
    },
});

const mockBucket = { file: mockFile };

// ── 상수 (index.js와 동일) ──
const THUMB_PREFIX = "thumbs/";
const THUMB_WIDTH = 240;
const THUMB_QUALITY = 80;
const ALLOWED_PREFIXES = ["reels_photos/", "profile_images/", "planner_photos/"];
const CACHE_CONTROL_MAP = {
    "reels_photos/": "public, max-age=86400",
    "profile_images/": "public, max-age=604800, immutable",
    "planner_photos/": "no-cache",
};

// generateThumbnail 핵심 로직을 추출하여 테스트 가능하게 만듦
async function generateThumbnailLogic(filePath, contentType, bucket) {
    // 무한루프 방지: thumbs/ 경로는 무시
    if (filePath.startsWith(THUMB_PREFIX)) {
        return { skipped: true, reason: "thumbs_prefix" };
    }

    // 이미지 파일만 처리
    if (!contentType || !contentType.startsWith("image/")) {
        return { skipped: true, reason: "not_image" };
    }

    // 허용된 경로만 처리
    const matchedPrefix = ALLOWED_PREFIXES.find((p) => filePath.startsWith(p));
    if (!matchedPrefix) {
        return { skipped: true, reason: "disallowed_prefix" };
    }

    const thumbPath = `${THUMB_PREFIX}${filePath}`;

    // 원본 다운로드
    const [originalBuffer] = await bucket.file(filePath).download();

    // sharp로 리사이즈
    const thumbBuffer = await sharp(originalBuffer)
        .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .webp({ quality: THUMB_QUALITY })
        .toBuffer();

    // 썸네일 업로드
    const thumbFile = bucket.file(thumbPath);
    await thumbFile.save(thumbBuffer, {
        metadata: {
            contentType: "image/webp",
            cacheControl: CACHE_CONTROL_MAP[matchedPrefix] || "public, max-age=86400",
        },
    });

    const reduction =
        originalBuffer.length > 0
            ? Math.round((1 - thumbBuffer.length / originalBuffer.length) * 100)
            : 0;

    return {
        skipped: false,
        filePath,
        thumbPath,
        originalSize: originalBuffer.length,
        thumbSize: thumbBuffer.length,
        reduction,
    };
}

// ── 테스트용 이미지 생성 헬퍼 ──
async function createTestImage(width, height, format = "png") {
    return sharp({
        create: {
            width,
            height,
            channels: 3,
            background: { r: 255, g: 0, b: 0 },
        },
    })
        .toFormat(format)
        .toBuffer();
}

// ── 테스트 ──────────────────────────────────────────────

describe("generateThumbnail", () => {
    beforeEach(() => {
        uploadedBuffer = null;
        uploadedMetadata = null;
        downloadBuffer = null;
    });

    // 1) thumbs/ 경로 스킵 (무한루프 방지)
    it("thumbs/ 경로 업로드는 스킵해야 한다", async () => {
        const result = await generateThumbnailLogic(
            "thumbs/reels_photos/uid/img.webp",
            "image/webp",
            mockBucket,
        );
        assert.strictEqual(result.skipped, true);
        assert.strictEqual(result.reason, "thumbs_prefix");
    });

    // 2) 이미지가 아닌 파일 스킵
    it("이미지가 아닌 파일은 스킵해야 한다", async () => {
        const result = await generateThumbnailLogic(
            "reels_photos/uid/doc.pdf",
            "application/pdf",
            mockBucket,
        );
        assert.strictEqual(result.skipped, true);
        assert.strictEqual(result.reason, "not_image");
    });

    // 3) contentType이 없는 경우 스킵
    it("contentType이 없으면 스킵해야 한다", async () => {
        const result = await generateThumbnailLogic(
            "reels_photos/uid/file",
            null,
            mockBucket,
        );
        assert.strictEqual(result.skipped, true);
        assert.strictEqual(result.reason, "not_image");
    });

    // 4) 허용되지 않은 경로 스킵
    it("허용되지 않은 경로는 스킵해야 한다", async () => {
        const result = await generateThumbnailLogic(
            "unknown_folder/uid/img.png",
            "image/png",
            mockBucket,
        );
        assert.strictEqual(result.skipped, true);
        assert.strictEqual(result.reason, "disallowed_prefix");
    });

    // 5) reels_photos 이미지 → 썸네일 정상 생성
    it("reels_photos 이미지를 240px WebP 썸네일로 변환해야 한다", async () => {
        downloadBuffer = await createTestImage(800, 600);

        const result = await generateThumbnailLogic(
            "reels_photos/uid123/photo.png",
            "image/png",
            mockBucket,
        );

        assert.strictEqual(result.skipped, false);
        assert.strictEqual(result.thumbPath, "thumbs/reels_photos/uid123/photo.png");
        assert.ok(result.thumbSize > 0, "썸네일 크기가 0보다 커야 한다");
        assert.ok(result.thumbSize < result.originalSize, "썸네일이 원본보다 작아야 한다");

        // 업로드된 메타데이터 확인
        assert.strictEqual(uploadedMetadata.contentType, "image/webp");
        assert.strictEqual(uploadedMetadata.cacheControl, "public, max-age=86400");

        // 실제 sharp로 메타데이터 검증
        const meta = await sharp(uploadedBuffer).metadata();
        assert.strictEqual(meta.format, "webp");
        assert.strictEqual(meta.width, 240);
    });

    // 6) profile_images → immutable 캐시 헤더
    it("profile_images는 immutable 캐시 헤더를 설정해야 한다", async () => {
        downloadBuffer = await createTestImage(500, 500);

        const result = await generateThumbnailLogic(
            "profile_images/uid456/avatar.jpg",
            "image/jpeg",
            mockBucket,
        );

        assert.strictEqual(result.skipped, false);
        assert.strictEqual(uploadedMetadata.cacheControl, "public, max-age=604800, immutable");
    });

    // 7) planner_photos → no-cache 헤더
    it("planner_photos는 no-cache 헤더를 설정해야 한다", async () => {
        downloadBuffer = await createTestImage(400, 300);

        const result = await generateThumbnailLogic(
            "planner_photos/uid789/plan.png",
            "image/png",
            mockBucket,
        );

        assert.strictEqual(result.skipped, false);
        assert.strictEqual(uploadedMetadata.cacheControl, "no-cache");
    });

    // 8) 원본이 240px 이하인 경우 확대하지 않음 (withoutEnlargement)
    it("240px 이하 이미지는 확대하지 않아야 한다", async () => {
        downloadBuffer = await createTestImage(100, 80);

        const result = await generateThumbnailLogic(
            "reels_photos/uid/small.png",
            "image/png",
            mockBucket,
        );

        assert.strictEqual(result.skipped, false);
        const meta = await sharp(uploadedBuffer).metadata();
        assert.strictEqual(meta.width, 100, "원본보다 확대되면 안 된다");
    });

    // 9) 큰 이미지 리사이즈 후 크기 감소율 검증
    it("큰 이미지는 상당한 크기 감소가 있어야 한다", async () => {
        downloadBuffer = await createTestImage(2000, 1500);

        const result = await generateThumbnailLogic(
            "reels_photos/uid/big.png",
            "image/png",
            mockBucket,
        );

        assert.strictEqual(result.skipped, false);
        assert.ok(result.reduction > 50, `크기 감소율이 50% 이상이어야 한다 (실제: ${result.reduction}%)`);
    });

    // 10) WebP 입력 이미지도 정상 처리
    it("WebP 입력 이미지도 정상 처리해야 한다", async () => {
        downloadBuffer = await createTestImage(600, 400, "webp");

        const result = await generateThumbnailLogic(
            "reels_photos/uid/photo.webp",
            "image/webp",
            mockBucket,
        );

        assert.strictEqual(result.skipped, false);
        const meta = await sharp(uploadedBuffer).metadata();
        assert.strictEqual(meta.format, "webp");
        assert.strictEqual(meta.width, 240);
    });

    // 11) 세로 이미지 비율 유지 확인
    it("세로 이미지의 종횡비를 유지해야 한다", async () => {
        // 600x900 (세로 이미지, 2:3 비율)
        downloadBuffer = await createTestImage(600, 900);

        const result = await generateThumbnailLogic(
            "profile_images/uid/portrait.png",
            "image/png",
            mockBucket,
        );

        assert.strictEqual(result.skipped, false);
        const meta = await sharp(uploadedBuffer).metadata();
        assert.strictEqual(meta.width, 240);
        // 240 * (900/600) = 360
        assert.strictEqual(meta.height, 360, "종횡비가 유지되어야 한다 (240x360)");
    });
});
