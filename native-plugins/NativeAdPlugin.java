package com.levelup.reboot.plugins;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.gms.ads.AdListener;
import com.google.android.gms.ads.AdLoader;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.nativead.MediaView;
import com.google.android.gms.ads.nativead.NativeAd;
import com.google.android.gms.ads.nativead.NativeAdOptions;
import com.google.android.gms.ads.nativead.NativeAdView;

/**
 * Capacitor 커스텀 플러그인: AdMob 네이티브 광고 고급형
 *
 * 소셜탭 랭킹 리스트 내 인라인 네이티브 광고를 표시합니다.
 * WebView 위에 NativeAdView를 오버레이하여 AdMob 정책을 준수합니다.
 *
 * 사용법 (app.js에서):
 *   const { NativeAd } = Capacitor.Plugins;
 *   await NativeAd.loadAd({ adId: '...', isTesting: false });
 *   await NativeAd.showAd({ x: 0, y: 300, width: 360, height: 120 });
 *
 * 등록 (MainActivity.java에서):
 *   import com.levelup.reboot.plugins.NativeAdPlugin;
 *   this.registerPlugin(NativeAdPlugin.class);
 */
@CapacitorPlugin(name = "NativeAd")
public class NativeAdPlugin extends Plugin {
    private static final String TAG = "NativeAdPlugin";

    private NativeAd currentAd = null;
    private NativeAdView nativeAdView = null;
    private FrameLayout adContainer = null;
    private boolean adLoaded = false;
    private boolean adVisible = false;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // --- 다크 테마 색상 (앱 CSS 변수에 매칭) ---
    private static final int COLOR_BG = Color.parseColor("#0f1923");
    private static final int COLOR_BORDER = Color.parseColor("#333333");
    private static final int COLOR_TEXT_PRIMARY = Color.parseColor("#e0e0e0");
    private static final int COLOR_TEXT_SUB = Color.parseColor("#888888");
    private static final int COLOR_ACCENT = Color.parseColor("#00d9ff");
    private static final int COLOR_AD_BADGE_BG = Color.parseColor("#FF8F00");
    private static final int COLOR_CTA_BG = Color.parseColor("#00d9ff");
    private static final int COLOR_CTA_TEXT = Color.parseColor("#000000");

    /**
     * 네이티브 광고 로드
     * @param call adId (String), isTesting (Boolean)
     */
    @PluginMethod()
    public void loadAd(PluginCall call) {
        String adId = call.getString("adId");
        boolean isTesting = call.getBoolean("isTesting", false);

        if (adId == null || adId.isEmpty()) {
            call.reject("adId is required");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity not available");
            return;
        }

        // 기존 광고 정리
        destroyAdInternal();

        mainHandler.post(() -> {
            try {
                AdLoader adLoader = new AdLoader.Builder(activity, adId)
                    .forNativeAd(nativeAd -> {
                        Log.i(TAG, "네이티브 광고 로드 완료");
                        currentAd = nativeAd;
                        adLoaded = true;
                        buildNativeAdView(activity, nativeAd);

                        JSObject result = new JSObject();
                        result.put("loaded", true);
                        call.resolve(result);
                    })
                    .withAdListener(new AdListener() {
                        @Override
                        public void onAdFailedToLoad(LoadAdError error) {
                            Log.w(TAG, "네이티브 광고 로드 실패: " + error.getMessage());
                            adLoaded = false;
                            call.reject("Ad failed to load: " + error.getMessage());
                        }
                    })
                    .withNativeAdOptions(new NativeAdOptions.Builder()
                        .setMediaAspectRatio(NativeAdOptions.NATIVE_MEDIA_ASPECT_RATIO_LANDSCAPE)
                        .build())
                    .build();

                adLoader.loadAd(new AdRequest.Builder().build());
            } catch (Exception e) {
                Log.e(TAG, "광고 로드 오류: " + e.getMessage());
                call.reject("Failed to load ad: " + e.getMessage());
            }
        });
    }

    /**
     * 광고를 지정된 좌표에 오버레이로 표시
     * @param call x, y, width, height (CSS 픽셀 단위)
     */
    @PluginMethod()
    public void showAd(PluginCall call) {
        if (!adLoaded || nativeAdView == null) {
            call.reject("Ad not loaded yet");
            return;
        }

        double x = call.getDouble("x", 0.0);
        double y = call.getDouble("y", 0.0);
        double width = call.getDouble("width", 0.0);
        double height = call.getDouble("height", 0.0);

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity not available");
            return;
        }

        mainHandler.post(() -> {
            try {
                DisplayMetrics dm = activity.getResources().getDisplayMetrics();
                float density = dm.density;

                int pxX = (int) (x * density);
                int pxY = (int) (y * density);
                int pxWidth = (int) (width * density);
                int pxHeight = (int) (height * density);

                // 기존 컨테이너 제거
                removeAdContainer();

                // 새 컨테이너 생성
                adContainer = new FrameLayout(activity);
                FrameLayout.LayoutParams containerParams = new FrameLayout.LayoutParams(
                    pxWidth > 0 ? pxWidth : ViewGroup.LayoutParams.MATCH_PARENT,
                    pxHeight > 0 ? pxHeight : ViewGroup.LayoutParams.WRAP_CONTENT
                );
                containerParams.leftMargin = pxX;
                containerParams.topMargin = pxY;
                containerParams.gravity = Gravity.TOP | Gravity.START;
                adContainer.setLayoutParams(containerParams);

                // NativeAdView를 컨테이너에 추가
                if (nativeAdView.getParent() != null) {
                    ((ViewGroup) nativeAdView.getParent()).removeView(nativeAdView);
                }
                adContainer.addView(nativeAdView, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                ));

                // Activity의 root에 오버레이 추가
                ViewGroup rootView = (ViewGroup) activity.getWindow().getDecorView()
                    .findViewById(android.R.id.content);
                rootView.addView(adContainer);

                adVisible = true;
                call.resolve();
            } catch (Exception e) {
                Log.e(TAG, "광고 표시 오류: " + e.getMessage());
                call.reject("Failed to show ad: " + e.getMessage());
            }
        });
    }

    /**
     * 스크롤 시 광고 Y 좌표 업데이트
     * @param call y (CSS 픽셀 단위)
     */
    @PluginMethod()
    public void updatePosition(PluginCall call) {
        double y = call.getDouble("y", 0.0);

        if (adContainer == null || !adVisible) {
            call.resolve();
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }

        mainHandler.post(() -> {
            try {
                DisplayMetrics dm = activity.getResources().getDisplayMetrics();
                int pxY = (int) (y * dm.density);

                FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) adContainer.getLayoutParams();
                if (params != null) {
                    params.topMargin = pxY;
                    adContainer.setLayoutParams(params);
                }
            } catch (Exception e) {
                Log.w(TAG, "위치 업데이트 오류: " + e.getMessage());
            }
        });
        call.resolve();
    }

    /**
     * 광고 오버레이 숨김 (리소스 유지)
     */
    @PluginMethod()
    public void hideAd(PluginCall call) {
        mainHandler.post(() -> {
            if (adContainer != null) {
                adContainer.setVisibility(View.GONE);
                adVisible = false;
            }
        });
        call.resolve();
    }

    /**
     * 숨긴 광고를 다시 표시
     */
    @PluginMethod()
    public void resumeAd(PluginCall call) {
        mainHandler.post(() -> {
            if (adContainer != null && adLoaded) {
                adContainer.setVisibility(View.VISIBLE);
                adVisible = true;
            }
        });
        call.resolve();
    }

    /**
     * 광고 완전 파괴 및 리소스 해제
     */
    @PluginMethod()
    public void destroyAd(PluginCall call) {
        destroyAdInternal();
        call.resolve();
    }

    /**
     * 광고 로드 상태 조회
     */
    @PluginMethod()
    public void isAdLoaded(PluginCall call) {
        JSObject result = new JSObject();
        result.put("loaded", adLoaded);
        result.put("visible", adVisible);
        call.resolve(result);
    }

    // ===== 내부 메서드 =====

    private void destroyAdInternal() {
        mainHandler.post(() -> {
            removeAdContainer();
            if (currentAd != null) {
                currentAd.destroy();
                currentAd = null;
            }
            nativeAdView = null;
            adLoaded = false;
            adVisible = false;
        });
    }

    private void removeAdContainer() {
        if (adContainer != null && adContainer.getParent() != null) {
            ((ViewGroup) adContainer.getParent()).removeView(adContainer);
        }
        adContainer = null;
    }

    /**
     * NativeAdView를 프로그래밍 방식으로 생성
     * 앱의 .user-card 다크 테마 스타일에 매칭
     */
    private void buildNativeAdView(Activity activity, NativeAd nativeAd) {
        DisplayMetrics dm = activity.getResources().getDisplayMetrics();
        float density = dm.density;

        // NativeAdView (루트)
        nativeAdView = new NativeAdView(activity);
        nativeAdView.setBackgroundColor(Color.TRANSPARENT);

        // 카드 컨테이너 (user-card 스타일 매칭)
        LinearLayout cardLayout = new LinearLayout(activity);
        cardLayout.setOrientation(LinearLayout.VERTICAL);
        cardLayout.setPadding(dp(10, density), dp(10, density), dp(10, density), dp(10, density));

        GradientDrawable cardBg = new GradientDrawable();
        cardBg.setColor(COLOR_BG);
        cardBg.setStroke(dp(1, density), COLOR_BORDER);
        cardBg.setCornerRadius(dp(6, density));
        cardLayout.setBackground(cardBg);

        // --- 상단: 아이콘 + 텍스트 + 광고 뱃지 ---
        LinearLayout topRow = new LinearLayout(activity);
        topRow.setOrientation(LinearLayout.HORIZONTAL);
        topRow.setGravity(Gravity.CENTER_VERTICAL);

        // 광고 아이콘
        ImageView iconView = new ImageView(activity);
        LinearLayout.LayoutParams iconParams = new LinearLayout.LayoutParams(dp(30, density), dp(30, density));
        iconParams.setMarginEnd(dp(8, density));
        iconView.setLayoutParams(iconParams);
        iconView.setScaleType(ImageView.ScaleType.CENTER_CROP);
        GradientDrawable iconBg = new GradientDrawable();
        iconBg.setCornerRadius(dp(15, density));
        iconBg.setColor(Color.parseColor("#333333"));
        iconView.setBackground(iconBg);
        iconView.setClipToOutline(true);
        if (nativeAd.getIcon() != null && nativeAd.getIcon().getDrawable() != null) {
            iconView.setImageDrawable(nativeAd.getIcon().getDrawable());
        }
        topRow.addView(iconView);
        nativeAdView.setIconView(iconView);

        // 텍스트 영역
        LinearLayout textColumn = new LinearLayout(activity);
        textColumn.setOrientation(LinearLayout.VERTICAL);
        textColumn.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        // "광고" 뱃지
        TextView adBadge = new TextView(activity);
        adBadge.setText("광고");
        adBadge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 9);
        adBadge.setTextColor(Color.WHITE);
        adBadge.setTypeface(null, Typeface.BOLD);
        GradientDrawable badgeBg = new GradientDrawable();
        badgeBg.setColor(COLOR_AD_BADGE_BG);
        badgeBg.setCornerRadius(dp(3, density));
        adBadge.setBackground(badgeBg);
        adBadge.setPadding(dp(4, density), dp(1, density), dp(4, density), dp(1, density));
        LinearLayout.LayoutParams badgeParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        badgeParams.setMarginEnd(dp(6, density));
        adBadge.setLayoutParams(badgeParams);

        // 뱃지 + Headline 행
        LinearLayout headlineRow = new LinearLayout(activity);
        headlineRow.setOrientation(LinearLayout.HORIZONTAL);
        headlineRow.setGravity(Gravity.CENTER_VERTICAL);
        headlineRow.addView(adBadge);

        // Headline
        TextView headlineView = new TextView(activity);
        headlineView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        headlineView.setTextColor(COLOR_TEXT_PRIMARY);
        headlineView.setTypeface(null, Typeface.BOLD);
        headlineView.setMaxLines(1);
        headlineView.setText(nativeAd.getHeadline() != null ? nativeAd.getHeadline() : "");
        headlineRow.addView(headlineView);
        nativeAdView.setHeadlineView(headlineView);

        textColumn.addView(headlineRow);

        // Body
        if (nativeAd.getBody() != null && !nativeAd.getBody().isEmpty()) {
            TextView bodyView = new TextView(activity);
            bodyView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
            bodyView.setTextColor(COLOR_TEXT_SUB);
            bodyView.setMaxLines(2);
            bodyView.setText(nativeAd.getBody());
            LinearLayout.LayoutParams bodyParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            bodyParams.topMargin = dp(2, density);
            bodyView.setLayoutParams(bodyParams);
            textColumn.addView(bodyView);
            nativeAdView.setBodyView(bodyView);
        }

        topRow.addView(textColumn);
        cardLayout.addView(topRow);

        // --- 중앙: MediaView ---
        if (nativeAd.getMediaContent() != null) {
            MediaView mediaView = new MediaView(activity);
            LinearLayout.LayoutParams mediaParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(150, density));
            mediaParams.topMargin = dp(8, density);
            mediaView.setLayoutParams(mediaParams);
            mediaView.setMediaContent(nativeAd.getMediaContent());
            cardLayout.addView(mediaView);
            nativeAdView.setMediaView(mediaView);
        }

        // --- 하단: CTA 버튼 ---
        if (nativeAd.getCallToAction() != null && !nativeAd.getCallToAction().isEmpty()) {
            Button ctaButton = new Button(activity);
            ctaButton.setText(nativeAd.getCallToAction());
            ctaButton.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            ctaButton.setTextColor(COLOR_CTA_TEXT);
            ctaButton.setTypeface(null, Typeface.BOLD);
            ctaButton.setAllCaps(false);

            GradientDrawable ctaBg = new GradientDrawable();
            ctaBg.setColor(COLOR_CTA_BG);
            ctaBg.setCornerRadius(dp(4, density));
            ctaButton.setBackground(ctaBg);
            ctaButton.setPadding(dp(12, density), dp(6, density), dp(12, density), dp(6, density));
            ctaButton.setMinHeight(0);
            ctaButton.setMinimumHeight(0);

            LinearLayout.LayoutParams ctaParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            ctaParams.topMargin = dp(8, density);
            ctaButton.setLayoutParams(ctaParams);

            cardLayout.addView(ctaButton);
            nativeAdView.setCallToActionView(ctaButton);
        }

        // Advertiser (선택적)
        if (nativeAd.getAdvertiser() != null && !nativeAd.getAdvertiser().isEmpty()) {
            TextView advertiserView = new TextView(activity);
            advertiserView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
            advertiserView.setTextColor(COLOR_TEXT_SUB);
            advertiserView.setText(nativeAd.getAdvertiser());
            LinearLayout.LayoutParams advParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            advParams.topMargin = dp(4, density);
            advertiserView.setLayoutParams(advParams);
            cardLayout.addView(advertiserView);
            nativeAdView.setAdvertiserView(advertiserView);
        }

        // NativeAdView에 카드 레이아웃 추가
        nativeAdView.addView(cardLayout, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // 네이티브 광고 등록 (노출/클릭 추적 활성화)
        nativeAdView.setNativeAd(nativeAd);

        Log.i(TAG, "NativeAdView 빌드 완료");
    }

    /** dp → px 변환 */
    private static int dp(int dp, float density) {
        return (int) (dp * density + 0.5f);
    }
}
