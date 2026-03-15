package com.levelup.reboot.plugins;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.fitness.Fitness;
import com.google.android.gms.fitness.FitnessOptions;
import com.google.android.gms.fitness.data.Bucket;
import com.google.android.gms.fitness.data.DataPoint;
import com.google.android.gms.fitness.data.DataSet;
import com.google.android.gms.fitness.data.DataType;
import com.google.android.gms.fitness.data.Field;
import com.google.android.gms.fitness.request.DataReadRequest;
import com.google.android.gms.fitness.result.DataReadResponse;
import com.google.android.gms.tasks.Tasks;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.concurrent.TimeUnit;

/**
 * Capacitor 커스텀 플러그인: Google Fit Android SDK를 통한 걸음 수 조회
 *
 * - Android 10+ 에서 ACTIVITY_RECOGNITION 런타임 권한을 먼저 요청 후 Google Fit OAuth 진행
 * - 권한 미승인 시 fallbackToRest: true 반환 → app.js에서 REST API 폴백 처리
 */
@CapacitorPlugin(name = "GoogleFit")
public class GoogleFitPlugin extends Plugin {
    private static final String TAG = "GoogleFitPlugin";
    private static final int GOOGLE_FIT_PERMISSIONS_REQUEST_CODE = 1001;
    private static final int ACTIVITY_RECOGNITION_REQUEST_CODE = 1002;

    private PluginCall savedPermissionsCall = null;

    private FitnessOptions getFitnessOptions() {
        return FitnessOptions.builder()
                .addDataType(DataType.TYPE_STEP_COUNT_DELTA, FitnessOptions.ACCESS_READ)
                .addDataType(DataType.AGGREGATE_STEP_COUNT_DELTA, FitnessOptions.ACCESS_READ)
                .build();
    }

    /** ACTIVITY_RECOGNITION 런타임 권한 승인 여부 확인 */
    private boolean hasActivityRecognitionPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true;
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACTIVITY_RECOGNITION)
                == PackageManager.PERMISSION_GRANTED;
    }

    /** 네이티브 Google 계정 획득 (getLastSignedInAccount → getAccountForExtension 폴백) */
    private GoogleSignInAccount getGoogleAccount() {
        GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(getContext());
        if (account == null) {
            // Firebase Auth WebView 로그인 시 네이티브 계정이 없을 수 있음
            // getAccountForExtension으로 Fitness 전용 계정 획득 시도
            try {
                account = GoogleSignIn.getAccountForExtension(getContext(), getFitnessOptions());
            } catch (Exception e) {
                Log.w(TAG, "getAccountForExtension 실패: " + e.getMessage());
            }
        }
        return account;
    }

    /** Google Fit SDK 사용 가능 여부 확인 */
    @PluginMethod()
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        try {
            GoogleSignInAccount account = getGoogleAccount();
            if (account == null) {
                // 계정 없지만 SDK 자체는 사용 가능 (requestPermissions로 로그인 유도)
                result.put("available", true);
                result.put("hasPermissions", false);
                result.put("needsSignIn", true);
                result.put("reason", "Google 계정 로그인이 필요합니다.");
                call.resolve(result);
                return;
            }
            boolean hasOAuth = GoogleSignIn.hasPermissions(account, getFitnessOptions());
            boolean hasAR = hasActivityRecognitionPermission();
            result.put("available", true);
            result.put("hasPermissions", hasOAuth && hasAR);
            result.put("hasActivityRecognition", hasAR);
            result.put("accountEmail", account.getEmail() != null ? account.getEmail() : "");
        } catch (Exception e) {
            Log.w(TAG, "Google Fit SDK 확인 실패: " + e.getMessage());
            result.put("available", false);
            result.put("hasPermissions", false);
            result.put("error", e.getMessage());
        }
        call.resolve(result);
    }

    /**
     * Google Fit 권한 요청
     * 1단계: ACTIVITY_RECOGNITION 런타임 권한 (Android 10+)
     * 2단계: Google Fit OAuth 동의 화면
     */
    @PluginMethod()
    public void requestPermissions(PluginCall call) {
        // 1단계: ACTIVITY_RECOGNITION 런타임 권한이 없으면 먼저 요청
        if (!hasActivityRecognitionPermission()) {
            call.setKeepAlive(true);
            savedPermissionsCall = call;
            pluginRequestPermissions(
                    new String[]{Manifest.permission.ACTIVITY_RECOGNITION},
                    ACTIVITY_RECOGNITION_REQUEST_CODE
            );
            return;
        }
        // 이미 권한 있음 → Google Fit OAuth 진행
        requestGoogleFitOAuth(call);
    }

    /**
     * ACTIVITY_RECOGNITION 권한 요청 결과 처리 후 Google Fit OAuth로 이어서 진행
     */
    @Override
    protected void handleRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.handleRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == ACTIVITY_RECOGNITION_REQUEST_CODE && savedPermissionsCall != null) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;

            if (granted) {
                Log.i(TAG, "ACTIVITY_RECOGNITION 권한 승인됨 → Google Fit OAuth 진행");
                requestGoogleFitOAuth(savedPermissionsCall);
            } else {
                Log.w(TAG, "ACTIVITY_RECOGNITION 권한 거부됨");
                JSObject result = new JSObject();
                result.put("granted", false);
                result.put("reason", "ACTIVITY_RECOGNITION 권한이 거부되었습니다. 앱 설정에서 허용해 주세요.");
                savedPermissionsCall.resolve(result);
                savedPermissionsCall = null;
            }
        }
    }

    /** Google Fit OAuth 동의 화면 표시 */
    private void requestGoogleFitOAuth(PluginCall call) {
        try {
            FitnessOptions fitnessOptions = getFitnessOptions();
            GoogleSignInAccount account = getGoogleAccount();

            if (account == null) {
                JSObject result = new JSObject();
                result.put("granted", false);
                result.put("reason", "Google 계정에 로그인되어 있지 않습니다. 먼저 로그인해 주세요.");
                call.resolve(result);
                savedPermissionsCall = null;
                return;
            }

            if (GoogleSignIn.hasPermissions(account, fitnessOptions)) {
                JSObject result = new JSObject();
                result.put("granted", true);
                result.put("message", "이미 Google Fit 권한이 부여되어 있습니다.");
                call.resolve(result);
                savedPermissionsCall = null;
                return;
            }

            call.setKeepAlive(true);
            savedPermissionsCall = call;
            GoogleSignIn.requestPermissions(
                    getActivity(),
                    GOOGLE_FIT_PERMISSIONS_REQUEST_CODE,
                    account,
                    fitnessOptions
            );
        } catch (Exception e) {
            Log.e(TAG, "Google Fit OAuth 요청 실패: " + e.getMessage());
            call.reject("Google Fit 권한 요청 실패: " + e.getMessage());
            savedPermissionsCall = null;
        }
    }

    /** Google Fit OAuth 결과 처리 */
    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);

        if (requestCode == GOOGLE_FIT_PERMISSIONS_REQUEST_CODE && savedPermissionsCall != null) {
            PluginCall call = savedPermissionsCall;
            savedPermissionsCall = null;

            JSObject result = new JSObject();
            if (resultCode == Activity.RESULT_OK) {
                result.put("granted", true);
                result.put("message", "Google Fit 권한이 부여되었습니다.");
                Log.i(TAG, "Google Fit OAuth 승인 완료");
            } else {
                result.put("granted", false);
                result.put("message", "Google Fit 권한 요청이 거부되었습니다.");
                Log.w(TAG, "Google Fit OAuth 거부됨 (resultCode=" + resultCode + ")");
            }
            call.resolve(result);
        }
    }

    /**
     * 오늘의 걸음 수 조회 (Google Fit History API)
     * ACTIVITY_RECOGNITION 권한 또는 OAuth 미승인 시 fallbackToRest: true 반환
     */
    @PluginMethod()
    public void getTodaySteps(PluginCall call) {
        new Thread(() -> {
            try {
                // ACTIVITY_RECOGNITION 런타임 권한 확인
                if (!hasActivityRecognitionPermission()) {
                    JSObject result = new JSObject();
                    result.put("steps", 0);
                    result.put("available", false);
                    result.put("needsPermission", true);
                    result.put("missingPermission", "ACTIVITY_RECOGNITION");
                    result.put("fallbackToRest", true);
                    call.resolve(result);
                    return;
                }

                FitnessOptions fitnessOptions = getFitnessOptions();
                GoogleSignInAccount account = getGoogleAccount();

                if (account == null || !GoogleSignIn.hasPermissions(account, fitnessOptions)) {
                    JSObject result = new JSObject();
                    result.put("steps", 0);
                    result.put("available", false);
                    result.put("needsPermission", true);
                    result.put("fallbackToRest", true);
                    call.resolve(result);
                    return;
                }

                LocalDate today = LocalDate.now();
                long startOfDay = today.atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli();
                long now = System.currentTimeMillis();

                DataReadRequest readRequest = new DataReadRequest.Builder()
                        .aggregate(DataType.TYPE_STEP_COUNT_DELTA)
                        .bucketByTime(1, TimeUnit.DAYS)
                        .setTimeRange(startOfDay, now, TimeUnit.MILLISECONDS)
                        .build();

                DataReadResponse response = Tasks.await(
                        Fitness.getHistoryClient(getContext(), account).readData(readRequest),
                        30, TimeUnit.SECONDS
                );

                long totalSteps = 0;
                for (Bucket bucket : response.getBuckets()) {
                    for (DataSet dataSet : bucket.getDataSets()) {
                        for (DataPoint dp : dataSet.getDataPoints()) {
                            totalSteps += dp.getValue(Field.FIELD_STEPS).asInt();
                        }
                    }
                }

                JSObject result = new JSObject();
                result.put("steps", totalSteps);
                result.put("available", true);
                result.put("source", "google_fit_native");
                result.put("date", today.toString());
                call.resolve(result);

            } catch (Exception e) {
                Log.e(TAG, "Google Fit 걸음 수 조회 실패: " + e.getMessage());
                JSObject result = new JSObject();
                result.put("steps", 0);
                result.put("available", false);
                result.put("fallbackToRest", true);
                result.put("error", e.getMessage());
                call.resolve(result);
            }
        }).start();
    }
}
