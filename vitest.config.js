// Unit suite. Pure logic only — no browser binary, milliseconds to run.
// Everything under engine/core/ must be reachable from here; if a piece
// of logic can only be tested with a real browser, it is in the wrong file.
export default {
    test: {
        environment: "node",
        include: ["test/**/*.test.js"],
        exclude: ["**/node_modules/**"]
    }
};
