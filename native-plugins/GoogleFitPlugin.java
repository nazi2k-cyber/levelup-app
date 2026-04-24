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
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
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
 * 3단계 권한 플로우:
 * 1) ACTIVITY_RECOGNITION 런타임 권한 (Android 10+)
 * 2) 네이티브 Google Sign-In (Firebase WebView 로그인과 별개)
 * 3) Google Fit OAuth 동의 화면
 */
@CapacitorPlugin(name = "GoogleFit")
public class GoogleFitPlugin extends Plugin {
    private static final String TAG = "GoogleFitPlugin";
    private static final int GOOGLE_FIT_PERMISSIONS_REQUEST_CODE = 1001;
    private static final int ACTIVITY_RECOGNITION_REQUEST_CODE = 1002;
    private static final int GOOGLE_SIGN_IN_REQUEST_CODE = 1003;
    private static final ZoneId KST_ZONE = ZoneId.of("Asia/Seoul");

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

    /** 네이티브 Google 계정 획득 */
    private GoogleSignInAccount getGoogleAccount() {
        GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(getContext());
        if (account == null) {
            try {
                account = GoogleSignIn.getAccountForExtension(getContext(), getFitnessOptions());
            } catch (Exception e) {
                Log.d(TAG, "getAccountForExtension 실패: " + e.getMessage());
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
                result.put("available", true);
                result.put("hasPermissions", false);
                result.put("needsSignIn", true);
                result.put("reason", "Google 계정 네이티브 로그인이 필요합니다.");
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
     * Google Fit 권한 요청 (3단계 플로우)
     * 1) ACTIVITY_RECOGNITION 런타임 권한 (Android 10+)
     * 2) 네이티브 Google Sign-In (계정이 없는 경우)
     * 3) Google Fit OAuth 동의 화면
     */
    @PluginMethod()
    public void requestPermissions(PluginCall call) {
        Log.i(TAG, "requestPermissions 시작");

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
        // 2단계: 네이티브 Google 계정 확인 → 없으면 Sign-In 실행
        proceedAfterActivityRecognition(call);
    }

    /** ACTIVITY_RECOGNITION 승인 후 → Google 계정 확인 → Sign-In or OAuth */
    private void proceedAfterActivityRecognition(PluginCall call) {
        GoogleSignInAccount account = getGoogleAccount();
        if (account == null) {
            // 네이티브 Google 계정이 없으므로 Sign-In 플로우 실행
            Log.i(TAG, "네이티브 Google 계정 없음 → Google Sign-In 실행");
            launchGoogleSignIn(call);
            return;
        }
        // 계정 있음 → Google Fit OAuth 진행
        requestGoogleFitOAuth(call, account);
    }

    /** 네이티브 Google Sign-In 실행 (Fitness 권한 포함) */
    private void launchGoogleSignIn(PluginCall call) {
        try {
            GoogleSignInOptions gso = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                    .requestEmail()
                    .addExtension(getFitnessOptions())
                    .build();
            GoogleSignInClient signInClient = GoogleSignIn.getClient(getContext(), gso);

            call.setKeepAlive(true);
            savedPermissionsCall = call;

            Intent signInIntent = signInClient.getSignInIntent();
            startActivityForResult(call, signInIntent, GOOGLE_SIGN_IN_REQUEST_CODE);
            Log.i(TAG, "Google Sign-In 인텐트 실행");
        } catch (Exception e) {
            Log.e(TAG, "Google Sign-In 실행 실패: " + e.getMessage());
            JSObject result = new JSObject();
            result.put("granted", false);
            result.put("reason", "Google Sign-In 실행 실패: " + e.getMessage());
            call.resolve(result);
        }
    }

    /**
     * ACTIVITY_RECOGNITION 권한 요청 결과 처리
     */
    @Override
    protected void handleRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.handleRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == ACTIVITY_RECOGNITION_REQUEST_CODE && savedPermissionsCall != null) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;

            if (granted) {
                Log.i(TAG, "ACTIVITY_RECOGNITION 권한 승인됨 → Google 계정 확인");
                proceedAfterActivityRecognition(savedPermissionsCall);
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
    private void requestGoogleFitOAuth(PluginCall call, GoogleSignInAccount account) {
        try {
            FitnessOptions fitnessOptions = getFitnessOptions();

            if (GoogleSignIn.hasPermissions(account, fitnessOptions)) {
                JSObject result = new JSObject();
                result.put("granted", true);
                result.put("message", "이미 Google Fit 권한이 부여되어 있습니다.");
                Log.i(TAG, "Google Fit 권한 이미 존재");
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
            Log.i(TAG, "Google Fit OAuth 동의 화면 실행");
        } catch (Exception e) {
            Log.e(TAG, "Google Fit OAuth 요청 실패: " + e.getMessage());
            call.reject("Google Fit 권한 요청 실패: " + e.getMessage());
            savedPermissionsCall = null;
        }
    }

    /** Activity 결과 처리 (Google Sign-In + Google Fit OAuth) */
    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);

        // Google Sign-In 결과 → OAuth로 이어서 진행
        if (requestCode == GOOGLE_SIGN_IN_REQUEST_CODE && savedPermissionsCall != null) {
            if (resultCode == Activity.RESULT_OK) {
                GoogleSignInAccount account = getGoogleAccount();
                if (account != null) {
                    Log.i(TAG, "Google Sign-In 성공: " + (account.getEmail() != null ? account.getEmail() : "unknown"));
                    // Sign-In에 Fitness 확장을 포함했으므로 이미 권한이 부여될 수 있음
                    if (GoogleSignIn.hasPermissions(account, getFitnessOptions())) {
                        JSObject result = new JSObject();
                        result.put("granted", true);
                        result.put("message", "Google Sign-In + Fit 권한 부여 완료");
                        Log.i(TAG, "Google Sign-In에서 Fit 권한도 함께 승인됨");
                        savedPermissionsCall.resolve(result);
                        savedPermissionsCall = null;
                        return;
                    }
                    // Fit 권한이 아직 없으면 OAuth 화면 추가 실행
                    requestGoogleFitOAuth(savedPermissionsCall, account);
                    return;
                }
            }
            // Sign-In 실패 또는 취소
            Log.w(TAG, "Google Sign-In 실패/취소 (resultCode=" + resultCode + ")");
            JSObject result = new JSObject();
            result.put("granted", false);
            result.put("reason", "Google 계정 로그인이 취소되었습니다.");
            savedPermissionsCall.resolve(result);
            savedPermissionsCall = null;
            return;
        }

        // Google Fit OAuth 결과
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

                LocalDate today = LocalDate.now(KST_ZONE);
                long startOfDay = today.atStartOfDay(KST_ZONE).toInstant().toEpochMilli();
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
                Log.i(TAG, "걸음 수 조회 성공: " + totalSteps + "보");
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
