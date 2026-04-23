package com.levelup.reboot.plugins;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.time.LocalDate;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Capacitor 커스텀 플러그인: Health Connect 가용성 확인 + 걸음 수 조회
 *
 * 메모:
 * - Health Connect 권한 UI는 앱 권한 화면이 아닌 Health Connect 설정 화면에서 관리됨.
 * - 기기/OS 조합에 따라 Health Connect 데이터 접근이 제한될 수 있어,
 *   최소 동작 보장을 위해 TYPE_STEP_COUNTER 센서 기반 폴백을 함께 제공한다.
 */
@CapacitorPlugin(name = "HealthConnect")
public class HealthConnectPlugin extends Plugin {
    private static final String TAG = "HealthConnect";
    private static final String HC_PACKAGE = "com.google.android.apps.healthdata";
    private static final String HC_PACKAGE_SYSTEM = "com.android.healthconnect.controller";

    private static final String PREFS = "levelup_health";
    private static final String KEY_BASELINE_DATE = "step_baseline_date";
    private static final String KEY_BASELINE_VALUE = "step_baseline_value";

    private static final int ACTIVITY_RECOGNITION_REQUEST_CODE = 2201;
    private PluginCall savedPermissionCall = null;

    private boolean hasActivityRecognitionPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true;
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACTIVITY_RECOGNITION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private boolean isHCInstalled() {
        String[] packages = (Build.VERSION.SDK_INT >= 34)
                ? new String[]{HC_PACKAGE_SYSTEM, HC_PACKAGE}
                : new String[]{HC_PACKAGE};
        for (String pkg : packages) {
            try {
                getContext().getPackageManager().getPackageInfo(pkg, 0);
                Log.i(TAG, "Health Connect found: " + pkg);
                return true;
            } catch (PackageManager.NameNotFoundException ignored) {
            }
        }
        return false;
    }

    private boolean openHealthConnectSettings() {
        String[] actions = new String[]{
                "androidx.health.ACTION_HEALTH_CONNECT_SETTINGS",
                "android.health.connect.action.HEALTH_HOME_SETTINGS",
                "android.settings.HEALTH_CONNECT_SETTINGS"
        };
        for (String action : actions) {
            try {
                Intent intent = new Intent(action);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(intent);
                Log.i(TAG, "Opened Health Connect settings via action=" + action);
                return true;
            } catch (Exception ignored) {
            }
        }
        return false;
    }

    @PluginMethod()
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        boolean installed = isHCInstalled();
        result.put("available", installed);
        result.put("sdkStatus", installed ? 3 : 1);
        result.put("hasActivityRecognition", hasActivityRecognitionPermission());
        call.resolve(result);
    }

    @PluginMethod()
    public void requestPermissions(PluginCall call) {
        if (!isHCInstalled()) {
            JSObject result = new JSObject();
            result.put("granted", false);
            result.put("reason", "Health Connect가 설치되어 있지 않습니다.");
            call.resolve(result);
            return;
        }

        if (!hasActivityRecognitionPermission()) {
            call.setKeepAlive(true);
            savedPermissionCall = call;
            pluginRequestPermissions(
                    new String[]{Manifest.permission.ACTIVITY_RECOGNITION},
                    ACTIVITY_RECOGNITION_REQUEST_CODE
            );
            return;
        }

        resolveAfterPermission(call);
    }

    @Override
    protected void handleRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.handleRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == ACTIVITY_RECOGNITION_REQUEST_CODE && savedPermissionCall != null) {
            PluginCall call = savedPermissionCall;
            savedPermissionCall = null;

            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (!granted) {
                JSObject result = new JSObject();
                result.put("granted", false);
                result.put("reason", "ACTIVITY_RECOGNITION 권한이 필요합니다.");
                call.resolve(result);
                return;
            }
            resolveAfterPermission(call);
        }
    }

    private void resolveAfterPermission(PluginCall call) {
        try {
            boolean opened = openHealthConnectSettings();
            if (!opened) {
                Intent storeIntent = new Intent(Intent.ACTION_VIEW,
                        Uri.parse("market://details?id=" + HC_PACKAGE));
                storeIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(storeIntent);
            }
            JSObject result = new JSObject();
            result.put("granted", true);
            result.put("settingsOpened", opened);
            result.put("message", opened
                    ? "Health Connect 설정 화면이 열렸습니다. 권한을 확인해주세요."
                    : "Health Connect를 찾을 수 없어 스토어를 열었습니다.");
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "권한 처리 실패: " + e.getMessage());
            call.reject("권한 처리 실패: " + e.getMessage());
        }
    }

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

                SensorManager sensorManager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
                if (sensorManager == null) {
                    JSObject result = new JSObject();
                    result.put("steps", 0);
                    result.put("available", false);
                    result.put("fallbackToRest", true);
                    result.put("error", "SENSOR_SERVICE unavailable");
                    call.resolve(result);
                    return;
                }

                Sensor stepCounter = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
                if (stepCounter == null) {
                    JSObject result = new JSObject();
                    result.put("steps", 0);
                    result.put("available", false);
                    result.put("fallbackToRest", true);
                    result.put("error", "TYPE_STEP_COUNTER unavailable");
                    call.resolve(result);
                    return;
                }

                CountDownLatch latch = new CountDownLatch(1);
                AtomicReference<Float> totalSinceBoot = new AtomicReference<>(null);

                SensorEventListener listener = new SensorEventListener() {
                    @Override
                    public void onSensorChanged(SensorEvent event) {
                        if (event != null && event.values != null && event.values.length > 0) {
                            totalSinceBoot.set(event.values[0]);
                            latch.countDown();
                        }
                    }

                    @Override
                    public void onAccuracyChanged(Sensor sensor, int accuracy) {
                    }
                };

                boolean registered = sensorManager.registerListener(listener, stepCounter, SensorManager.SENSOR_DELAY_NORMAL);
                if (!registered) {
                    JSObject result = new JSObject();
                    result.put("steps", 0);
                    result.put("available", false);
                    result.put("fallbackToRest", true);
                    result.put("error", "Sensor listener registration failed");
                    call.resolve(result);
                    return;
                }

                boolean received = latch.await(2, TimeUnit.SECONDS);
                sensorManager.unregisterListener(listener);

                if (!received || totalSinceBoot.get() == null) {
                    JSObject result = new JSObject();
                    result.put("steps", 0);
                    result.put("available", false);
                    result.put("fallbackToRest", true);
                    result.put("error", "Step sensor timeout");
                    call.resolve(result);
                    return;
                }

                float current = totalSinceBoot.get();
                String today = LocalDate.now().toString();

                SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                String baselineDate = prefs.getString(KEY_BASELINE_DATE, "");
                float baselineValue = prefs.getFloat(KEY_BASELINE_VALUE, -1f);

                if (!today.equals(baselineDate) || baselineValue < 0f || current < baselineValue) {
                    baselineValue = current;
                    prefs.edit()
                            .putString(KEY_BASELINE_DATE, today)
                            .putFloat(KEY_BASELINE_VALUE, baselineValue)
                            .apply();
                }

                long steps = Math.max(0, Math.round(current - baselineValue));

                JSObject result = new JSObject();
                result.put("steps", steps);
                result.put("available", true);
                result.put("fallbackToRest", false);
                result.put("source", "health_connect_sensor");
                result.put("date", today);
                call.resolve(result);

            } catch (Exception e) {
                JSObject result = new JSObject();
                result.put("steps", 0);
                result.put("available", false);
                result.put("fallbackToRest", true);
                result.put("error", e.getMessage());
                call.resolve(result);
            }
        }).start();
    }

    @PluginMethod()
    public void openHealthConnect(PluginCall call) {
        try {
            if (openHealthConnectSettings()) {
                call.resolve();
                return;
            }
            Intent storeIntent = new Intent(Intent.ACTION_VIEW,
                    Uri.parse("market://details?id=" + HC_PACKAGE));
            storeIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(storeIntent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Health Connect를 열 수 없습니다: " + e.getMessage());
        }
    }
}
