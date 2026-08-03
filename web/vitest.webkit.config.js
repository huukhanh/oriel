// Real-WebKit suite. Separate from the default run because it needs a browser
// binary and takes seconds rather than milliseconds.
export default {
    test: {
        environment: "node",
        include: ["webkit/**/*.webkit.test.js"],
        testTimeout: 60_000,
        hookTimeout: 90_000,
        // WebKit contexts are cheap but the browser is not; one worker keeps
        // the single shared browser instance honest.
        pool: "forks",
        poolOptions: { forks: { singleFork: true } }
    }
};
