package com.levelup.reboot.plugins;

import android.app.Activity;
import android.util.Log;

import androidx.annotation.NonNull;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;

/**
 * Capacitor 커스텀 플러그인: Google AdMob 보상형 광고
 *
 * 사용법 (JavaScript):
 *   const result = await window.Capacitor.Plugins.RewardedAd.showRewardedAd({ adUnitId: 'ca-app-pub-xxx/xxx' });
 *   if (result.rewarded) { // 보상 지급 }
 */
@CapacitorPlugin(name = "RewardedAd")
public class RewardedAdPlugin extends Plugin {
    private static final String TAG = "RewardedAdPlugin";
    private static boolean adsInitialized = false;

    @Override
    public void load() {
        super.load();
        if (!adsInitialized) {
            MobileAds.initialize(getContext(), initializationStatus -> {
                Log.i(TAG, "AdMob SDK 초기화 완료");
                adsInitialized = true;
            });
        }
    }

    @PluginMethod()
    public void showRewardedAd(PluginCall call) {
        String adUnitId = call.getString("adUnitId");
        if (adUnitId == null || adUnitId.isEmpty()) {
            call.reject("adUnitId가 필요합니다.");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity를 찾을 수 없습니다.");
            return;
        }

        call.setKeepAlive(true);

        activity.runOnUiThread(() -> {
            AdRequest adRequest = new AdRequest.Builder().build();
            RewardedAd.load(activity, adUnitId, adRequest, new RewardedAdLoadCallback() {
                @Override
                public void onAdFailedToLoad(@NonNull LoadAdError loadAdError) {
                    Log.e(TAG, "보상형 광고 로드 실패: " + loadAdError.getMessage());
                    JSObject result = new JSObject();
                    result.put("rewarded", false);
                    result.put("error", loadAdError.getMessage());
                    call.resolve(result);
                }

                @Override
                public void onAdLoaded(@NonNull RewardedAd rewardedAd) {
                    Log.i(TAG, "보상형 광고 로드 성공");

                    rewardedAd.setFullScreenContentCallback(new FullScreenContentCallback() {
                        @Override
                        public void onAdDismissedFullScreenContent() {
                            Log.i(TAG, "광고 닫힘");
                        }

                        @Override
                        public void onAdFailedToShowFullScreenContent(@NonNull AdError adError) {
                            Log.e(TAG, "광고 표시 실패: " + adError.getMessage());
                            JSObject result = new JSObject();
                            result.put("rewarded", false);
                            result.put("error", adError.getMessage());
                            call.resolve(result);
                        }
                    });

                    rewardedAd.show(activity, rewardItem -> {
                        int amount = rewardItem.getAmount();
                        String type = rewardItem.getType();
                        Log.i(TAG, "보상 획득: " + amount + " " + type);

                        JSObject result = new JSObject();
                        result.put("rewarded", true);
                        result.put("amount", amount);
                        result.put("type", type);
                        call.resolve(result);
                    });
                }
            });
        });
    }
}
