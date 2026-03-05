package com.levelup.reboot.plugins;

import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor 커스텀 플러그인: Android 앱 설정 화면 열기
 *
 * 사용법 (app.js에서):
 *   Capacitor.toNative('AppSettings', 'open', {});
 *
 * 등록 (MainActivity.java에서):
 *   import com.levelup.reboot.plugins.AppSettingsPlugin;
 *   ...
 *   this.registerPlugin(AppSettingsPlugin.class);
 */
@CapacitorPlugin(name = "AppSettings")
public class AppSettingsPlugin extends Plugin {

    @PluginMethod()
    public void open(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getActivity().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("앱 설정을 열 수 없습니다: " + e.getMessage());
        }
    }
}
