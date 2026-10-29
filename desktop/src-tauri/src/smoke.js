// Injected in --smoke mode only: tells the app when the editor has mounted, and which errors it logged.
(() => {
  if (window.top !== window || location.hostname !== '127.0.0.1') return;
  const errors = [];
  const send = (mounted) => {
    const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
    if (invoke) invoke('smoke_report', { mounted, errors, url: location.href }).catch(() => {});
  };
  const note = (text) => {
    errors.push(String(text).slice(0, 500));
    if (errors.length > 50) errors.shift();
    send(false);
  };
  window.addEventListener('error', (event) => note(event.message));
  window.addEventListener('unhandledrejection', (event) => note(`unhandled rejection: ${(event.reason && event.reason.message) || event.reason}`));
  const logged = console.error;
  console.error = (...args) => {
    note(args.map(String).join(' '));
    logged.apply(console, args);
  };
  // The editor replaces the loader inside #root when React renders.
  const mounted = () => {
    const root = document.getElementById('root');
    return !!root && root.children.length > 0 && !root.querySelector('.ofk-loader-screen');
  };
  const observer = new MutationObserver(() => check());
  const check = () => {
    if (!mounted()) return;
    observer.disconnect();
    send(true);
  };
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    check();
  });
})();
