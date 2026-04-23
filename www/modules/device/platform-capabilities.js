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
        const plugins = getPlugins();
        return !!(isNativePlatform() && plugins && (plugins.HealthConnect || plugins.GoogleFit));
    }

    function getGeolocationPlugin() {
        const plugins = getPlugins();
        return plugins && plugins.Geolocation ? plugins.Geolocation : null;
    }

    return {
        isNativePlatform,
        isWebPlatform,
        supportsHealth,
        supportsPush,
        supportsGps,
        getGeolocationPlugin,
        getCapacitor: () => capacitor,
    };
}
