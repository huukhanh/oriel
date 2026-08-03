// Fast suite: pure logic under jsdom, no browser binary required.
// The real-WebKit suite lives in vitest.webkit.config.js and is run separately.
export default {
    test: {
        environment: "jsdom",
        include: ["test/**/*.test.js"]
    }
};
