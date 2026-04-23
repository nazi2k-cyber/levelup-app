export function createPlatformCapabilities(capacitor = window.Capacitor) {
    function isNativePlatform() {
        return !!(capacitor && capacitor.isNativePlatform && capacitor.isNativePlatform());
    }

    function isWebPlatform() {
        return !isNativePlatform();
    }

    function getPlugins() {
        return capacitor && capacitor.Plugins ? capacitor.Plugins : null;
    }

    function supportsGps() {
        const plugins = getPlugins();
        return !!(isNativePlatform() && plugins && plugins.Geolocation);
    }

    function supportsPush() {
        const plugins = getPlugins();
        return !!(isNativePlatform() && plugins && plugins.PushNotifications);
    }

    function supportsHealth() {
        const info = getHealthSupportInfo();
        return !!info.supported;
    }

    function getHealthSupportInfo() {
        const native = isNativePlatform();
        const plugins = getPlugins();
        const hasHealthConnect = !!(plugins && plugins.HealthConnect);
        const hasGoogleFit = !!(plugins && plugins.GoogleFit);

        if (!native) {
            return {
                supported: false,
                reason: 'non_native_platform',
                hasHealthConnect,
                hasGoogleFit,
            };
        }

        if (!hasHealthConnect && !hasGoogleFit) {
            return {
                supported: false,
                reason: 'health_plugin_missing',
                hasHealthConnect,
                hasGoogleFit,
            };
        }

        return {
            supported: true,
            reason: 'supported',
            hasHealthConnect,
            hasGoogleFit,
        };
    }

    function getGeolocationPlugin() {
        const plugins = getPlugins();
        return plugins && plugins.Geolocation ? plugins.Geolocation : null;
    }

    return {
        isNativePlatform,
        isWebPlatform,
        supportsHealth,
        getHealthSupportInfo,
        supportsPush,
        supportsGps,
        getGeolocationPlugin,
        getCapacitor: () => capacitor,
    };
}
