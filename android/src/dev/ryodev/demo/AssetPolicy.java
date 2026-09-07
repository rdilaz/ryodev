package dev.ryodev.demo;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/** Fixed APK resources only. No filesystem path is ever derived from a request. */
public final class AssetPolicy {
    public static final String ORIGIN = "https://appassets.androidplatform.net";
    public static final String START_URL = ORIGIN + "/index.html";
    public static final String CSP = "default-src 'none'; script-src 'self'; style-src 'self'; "
        + "img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; "
        + "worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    private static final Map<String, String> TYPES;
    static {
        Map<String, String> types = new HashMap<>();
        types.put("/index.html", "text/html");
        types.put("/src/app.js", "text/javascript");
        types.put("/src/model.js", "text/javascript");
        types.put("/src/fixtures.js", "text/javascript");
        types.put("/src/styles.css", "text/css");
        types.put("/assets/workstation.svg", "image/svg+xml");
        TYPES = Collections.unmodifiableMap(types);
    }

    private AssetPolicy() { }

    public static String allowedPath(String url) {
        if (url == null) return null;
        try {
            URI uri = new URI(url);
            if (!"https".equals(uri.getScheme())
                    || !"appassets.androidplatform.net".equals(uri.getRawAuthority())
                    || uri.getRawQuery() != null) return null;
            // Exact raw path matching also rejects encoded slashes, traversal and backslashes.
            String path = uri.getRawPath();
            return TYPES.containsKey(path) ? path : null;
        } catch (URISyntaxException malformed) {
            return null;
        }
    }

    public static boolean allowsNavigation(String url) {
        return "/index.html".equals(allowedPath(url));
    }

    public static String mimeType(String path) { return TYPES.get(path); }
}
