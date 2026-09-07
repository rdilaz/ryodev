package dev.ryodev.demo;

public final class AssetPolicyTest {
    public static void main(String[] args) {
        String origin = AssetPolicy.ORIGIN;
        String[] allowed = {"/index.html", "/src/app.js", "/src/model.js", "/src/fixtures.js",
                "/src/styles.css", "/assets/workstation.svg"};
        for (String path : allowed) {
            require(path.equals(AssetPolicy.allowedPath(origin + path)), "bundled asset " + path);
            require(AssetPolicy.mimeType(path) != null, "MIME " + path);
        }
        String[] rejected = {null, "", "https://example.com/index.html", "http://appassets.androidplatform.net/index.html",
                "https://appassets.androidplatform.net.evil.test/index.html", "https://appassets.androidplatform.net@evil.test/index.html",
                "https://user@appassets.androidplatform.net/index.html", origin + ":443/index.html",
                origin + "/src/../index.html", origin + "/%69ndex.html", origin + "/src%2Fapp.js",
                origin + "/src\\app.js", origin + "/index.html?external=1", origin + "/missing.js",
                origin + "/", "file:///index.html", "content://index.html", "javascript:alert(1)",
                "data:text/html,hello", "intent://index.html", "blob:" + origin + "/index.html"};
        for (String url : rejected) require(AssetPolicy.allowedPath(url) == null, "reject " + url);
        require(AssetPolicy.allowsNavigation(origin + "/index.html#needs-heading"), "in-page anchor");
        require(!AssetPolicy.allowsNavigation(origin + "/src/app.js"), "no source-file navigation");
        System.out.println("Asset policy passed: 6 allowed assets, 21 rejected URLs, navigation and MIME checks.");
    }
    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
