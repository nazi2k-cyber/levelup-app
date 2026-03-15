package com.levelup.reboot.plugins;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor 커스텀 플러그인: Health Connect 가용성 확인 및 설정 열기
 *
 * Health Connect Kotlin suspend API는 Java에서 직접 호출 불가.
 * 걸음 수 데이터는 app.js의 Google Fit REST API 폴백으로 처리.
 *
 * 사용법 (app.js):
 *   const { HealthConnect } = Capacitor.Plugins;
 *   const { available } = await HealthConnect.isAvailable();
 */
@CapacitorPlugin(name = "HealthConnect")
public class HealthConnectPlugin extends Plugin {
    private static final String TAG = "HealthConnect";
    private static final String HC_PACKAGE = "com.google.android.apps.healthdata";
    private static final String HC_PACKAGE_SYSTEM = "com.android.healthconnect.controller";

    private boolean isHCInstalled() {
        // Android 14+ 에서는 Health Connect가 시스템에 내장됨 (다른 패키지명)
        String[] packages = (Build.VERSION.SDK_INT >= 34)
                ? new String[]{HC_PACKAGE_SYSTEM, HC_PACKAGE}
                : new String[]{HC_PACKAGE};
        for (String pkg : packages) {
            try {
                getContext().getPackageManager().getPackageInfo(pkg, 0);
                Log.i(TAG, "Health Connect found: " + pkg);
                return true;
            } catch (PackageManager.NameNotFoundException ignored) {}
        }
        return false;
    }

    /** Health Connect 설치 여부 확인 */
    @PluginMethod()
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        boolean available = isHCInstalled();
        result.put("available", available);
        result.put("sdkStatus", available ? 3 : 1); // 3=SDK_AVAILABLE, 1=SDK_UNAVAILABLE
        call.resolve(result);
    }

    /**
     * Health Connect 설정 화면 열기 (권한 관리)
     * 참고: 설정 화면을 열 뿐이며 실제 권한 승인은 사용자가 직접 해야 함
     */
    @PluginMethod()
    public void requestPermissions(PluginCall call) {
        try {
            if (!isHCInstalled()) {
                JSObject result = new JSObject();
                result.put("granted", false);
                result.put("reason", "Health Connect가 설치되어 있지 않습니다.");
                call.resolve(result);
                return;
            }
            Intent intent = new Intent("androidx.health.ACTION_HEALTH_CONNECT_SETTINGS");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            JSObject result = new JSObject();
            // 설정 화면만 열었으므로 granted=false (사용자가 직접 허용해야 함)
            result.put("granted", false);
            result.put("settingsOpened", true);
            result.put("message", "Health Connect 설정 화면이 열렸습니다. 걸음 수 권한을 허용해주세요.");
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "HC 설정 열기 실패: " + e.getMessage());
            call.reject("Health Connect 설정 열기 실패: " + e.getMessage());
        }
    }

    /**
     * 오늘 걸음 수 조회 — REST API 폴백 반환
     * Health Connect suspend API는 Java에서 직접 호출 불가.
     * app.js의 Google Fit REST API 폴백이 데이터를 처리.
     */
    @PluginMethod()
    public void getTodaySteps(PluginCall call) {
        JSObject result = new JSObject();
        result.put("steps", 0);
        result.put("available", isHCInstalled());
        result.put("fallbackToRest", true);
        call.resolve(result);
    }

    /** Health Connect 앱 열기 (미설치 시 Play Store 이동) */
    @PluginMethod()
    public void openHealthConnect(PluginCall call) {
        try {
            Intent intent = new Intent("androidx.health.ACTION_HEALTH_CONNECT_SETTINGS");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            try {
                Intent storeIntent = new Intent(Intent.ACTION_VIEW,
                        Uri.parse("market://details?id=" + HC_PACKAGE));
                storeIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(storeIntent);
                call.resolve();
            } catch (Exception e2) {
                call.reject("Health Connect를 열 수 없습니다: " + e2.getMessage());
            }
        }
    }
}
