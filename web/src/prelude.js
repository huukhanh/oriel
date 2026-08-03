// Injected once per content world, at document-start, before any user script.
// Responsibilities: patch history exactly once and dispatch __inj:navigate,
// install the GM shim, capture console. See .claude/skills/webkit-injection.
export function installPrelude(win = window) {
  if (win.__injPreludeInstalled) return;
  win.__injPreludeInstalled = true;

  const fire = () => win.dispatchEvent(new win.Event("__inj:navigate"));
  const { pushState, replaceState } = win.history;
  win.history.pushState = function (...a) { pushState.apply(this, a); fire(); };
  win.history.replaceState = function (...a) { replaceState.apply(this, a); fire(); };
  win.addEventListener("popstate", fire);
}
