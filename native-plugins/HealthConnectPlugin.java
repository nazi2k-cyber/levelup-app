package com.levelup.reboot.plugins;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.health.connect.client.HealthConnectClient;
import androidx.health.connect.client.permission.HealthPermission;
import androidx.health.connect.client.records.StepsRecord;
import androidx.health.connect.client.request.AggregateRequest;
import androidx.health.connect.client.request.ReadRecordsRequest;
import androidx.health.connect.client.aggregate.AggregateMetric;
import androidx.health.connect.client.aggregate.AggregationResult;
import androidx.health.connect.client.time.TimeRangeFilter;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.Set;

/**
 * Capacitor 커스텀 플러그인: Health Connect (Android 14+) 를 통한 건강 데이터 접근
 *
 * - Android 14+ 기기에서 Health Connect API를 사용하여 걸음 수 데이터를 읽어옴
 * - Health Connect가 없는 기기에서는 Google Fit REST API 폴백 사용 (app.js에서 처리)
 *
 * 사용법 (app.js에서):
 *   const { HealthConnect } = Capacitor.Plugins;
 *   const result = await HealthConnect.getTodaySteps();
 *
 * 등록 (MainActivity.java에서 - GitHub Actions에서 자동 주입):
 *   import com.levelup.reboot.plugins.HealthConnectPlugin;
 *   this.registerPlugin(HealthConnectPlugin.class);
 */
@CapacitorPlugin(name = "HealthConnect")
public class HealthConnectPlugin extends Plugin {
    private static final String TAG = "HealthConnect";

    /**
     * Health Connect SDK 사용 가능 여부 확인
     */
    @PluginMethod()
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        try {
            int status = HealthConnectClient.getSdkStatus(getContext());
            boolean available = (status == HealthConnectClient.SDK_AVAILABLE);
            result.put("available", available);
            result.put("sdkStatus", status);

            if (status == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
                result.put("needsUpdate", true);
            }
        } catch (Exception e) {
            Log.w(TAG, "Health Connect SDK 확인 실패: " + e.getMessage());
            result.put("available", false);
            result.put("error", e.getMessage());
        }
        call.resolve(result);
    }

    /**
     * Health Connect 권한 요청
     * - STEPS 읽기 권한을 요청
     */
    @PluginMethod()
    public void requestPermissions(PluginCall call) {
        try {
            int status = HealthConnectClient.getSdkStatus(getContext());
            if (status != HealthConnectClient.SDK_AVAILABLE) {
                JSObject result = new JSObject();
                result.put("granted", false);
                result.put("reason", "Health Connect를 사용할 수 없습니다.");
                call.resolve(result);
                return;
            }

            // Health Connect 권한 요청 Intent
            Set<String> permissions = new HashSet<>();
            permissions.add(HealthPermission.getReadPermission(StepsRecord.class));

            Intent intent = HealthConnectClient.getOrCreate(getContext())
                    .permissionController
                    .createRequestPermissionResultContract()
                    .createIntent(getContext(), permissions);

            getActivity().startActivity(intent);

            JSObject result = new JSObject();
            result.put("granted", true);
            result.put("message", "권한 요청 다이얼로그 표시됨");
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "권한 요청 실패: " + e.getMessage());
            call.reject("Health Connect 권한 요청 실패: " + e.getMessage());
        }
    }

    /**
     * 오늘의 걸음 수 데이터 조회
     * - Health Connect에서 오늘 자정부터 현재까지의 총 걸음 수 반환
     */
    @PluginMethod()
    public void getTodaySteps(PluginCall call) {
        try {
            int status = HealthConnectClient.getSdkStatus(getContext());
            if (status != HealthConnectClient.SDK_AVAILABLE) {
                JSObject result = new JSObject();
                result.put("steps", 0);
                result.put("available", false);
                result.put("fallbackToRest", true);
                call.resolve(result);
                return;
            }

            HealthConnectClient client = HealthConnectClient.getOrCreate(getContext());

            // 오늘 자정부터 현재까지
            LocalDate today = LocalDate.now();
            Instant startOfDay = today.atStartOfDay(ZoneId.systemDefault()).toInstant();
            Instant now = Instant.now();

            TimeRangeFilter timeRange = TimeRangeFilter.between(startOfDay, now);

            // 걸음 수 집계 요청
            Set<AggregateMetric<?>> metrics = new HashSet<>();
            metrics.add(StepsRecord.COUNT_TOTAL);

            AggregateRequest request = new AggregateRequest(
                    metrics,
                    timeRange,
                    new HashSet<>()
            );

            // 비동기 실행 - 결과를 Capacitor 콜백으로 반환
            new Thread(() -> {
                try {
                    AggregationResult aggregation = client.aggregate(request).get();
                    Long steps = aggregation.get(StepsRecord.COUNT_TOTAL);

                    JSObject result = new JSObject();
                    result.put("steps", steps != null ? steps : 0);
                    result.put("available", true);
                    result.put("source", "health_connect");
                    result.put("date", today.toString());
                    call.resolve(result);
                } catch (Exception e) {
                    Log.e(TAG, "걸음 수 조회 실패: " + e.getMessage());
                    JSObject result = new JSObject();
                    result.put("steps", 0);
                    result.put("available", false);
                    result.put("fallbackToRest", true);
                    result.put("error", e.getMessage());
                    call.resolve(result);
                }
            }).start();

        } catch (Exception e) {
            Log.e(TAG, "getTodaySteps 오류: " + e.getMessage());
            JSObject result = new JSObject();
            result.put("steps", 0);
            result.put("available", false);
            result.put("fallbackToRest", true);
            result.put("error", e.getMessage());
            call.resolve(result);
        }
    }

    /**
     * Health Connect 앱 설정 열기
     * - 앱이 설치되어 있지 않으면 Play Store로 이동
     */
    @PluginMethod()
    public void openHealthConnect(PluginCall call) {
        try {
            String action = "androidx.health.ACTION_HEALTH_CONNECT_SETTINGS";
            Intent intent = new Intent(action);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            // Health Connect 앱이 없으면 Play Store로 이동
            try {
                Intent storeIntent = new Intent(Intent.ACTION_VIEW,
                        Uri.parse("market://details?id=com.google.android.apps.healthdata"));
                storeIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(storeIntent);
                call.resolve();
            } catch (Exception e2) {
                call.reject("Health Connect를 열 수 없습니다: " + e2.getMessage());
            }
        }
    }
}
