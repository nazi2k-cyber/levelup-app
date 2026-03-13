package com.levelup.reboot.plugins;

import android.util.Log;

import androidx.annotation.NonNull;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.firebase.messaging.FirebaseMessaging;

/**
 * Capacitor 커스텀 플러그인: Firebase Cloud Messaging (FCM) 푸시 알림
 *
 * 기능:
 *   - FCM 토큰 조회 및 갱신
 *   - 푸시 알림 토픽 구독/해제
 *   - 알림 권한 상태 확인
 *
 * 등록 (MainActivity.java에서):
 *   import com.levelup.reboot.plugins.FCMPlugin;
 *   ...
 *   this.registerPlugin(FCMPlugin.class);
 */
@CapacitorPlugin(name = "FCMPlugin")
public class FCMPlugin extends Plugin {

    private static final String TAG = "FCMPlugin";

    /**
     * FCM 등록 토큰을 가져옵니다.
     * 반환: { token: "fcm_token_string" }
     */
    @PluginMethod()
    public void getToken(PluginCall call) {
        FirebaseMessaging.getInstance().getToken()
            .addOnSuccessListener(token -> {
                Log.d(TAG, "FCM Token: " + token);
                JSObject result = new JSObject();
                result.put("token", token);
                call.resolve(result);
            })
            .addOnFailureListener(e -> {
                Log.e(TAG, "FCM Token 획득 실패", e);
                call.reject("FCM 토큰을 가져올 수 없습니다: " + e.getMessage());
            });
    }

    /**
     * 특정 토픽을 구독합니다.
     * 파라미터: { topic: "topic_name" }
     */
    @PluginMethod()
    public void subscribeTopic(PluginCall call) {
        String topic = call.getString("topic");
        if (topic == null || topic.isEmpty()) {
            call.reject("토픽명이 필요합니다.");
            return;
        }

        FirebaseMessaging.getInstance().subscribeToTopic(topic)
            .addOnSuccessListener(unused -> {
                Log.d(TAG, "토픽 구독 완료: " + topic);
                JSObject result = new JSObject();
                result.put("subscribed", true);
                result.put("topic", topic);
                call.resolve(result);
            })
            .addOnFailureListener(e -> {
                Log.e(TAG, "토픽 구독 실패: " + topic, e);
                call.reject("토픽 구독 실패: " + e.getMessage());
            });
    }

    /**
     * 특정 토픽 구독을 해제합니다.
     * 파라미터: { topic: "topic_name" }
     */
    @PluginMethod()
    public void unsubscribeTopic(PluginCall call) {
        String topic = call.getString("topic");
        if (topic == null || topic.isEmpty()) {
            call.reject("토픽명이 필요합니다.");
            return;
        }

        FirebaseMessaging.getInstance().unsubscribeFromTopic(topic)
            .addOnSuccessListener(unused -> {
                Log.d(TAG, "토픽 구독 해제: " + topic);
                JSObject result = new JSObject();
                result.put("unsubscribed", true);
                result.put("topic", topic);
                call.resolve(result);
            })
            .addOnFailureListener(e -> {
                Log.e(TAG, "토픽 구독 해제 실패: " + topic, e);
                call.reject("토픽 구독 해제 실패: " + e.getMessage());
            });
    }

    /**
     * FCM 자동 초기화 활성화/비활성화
     * 파라미터: { enabled: true/false }
     */
    @PluginMethod()
    public void setAutoInit(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled", true);
        FirebaseMessaging.getInstance().setAutoInitEnabled(enabled);
        Log.d(TAG, "FCM 자동 초기화: " + enabled);
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }
}
