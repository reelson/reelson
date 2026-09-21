/**
 * Injected into every page before load. Playwright's synthetic mouse never
 * moves the OS cursor, and screen/video capture never shows it either, so we
 * draw our own: a large macOS-style black arrow that follows `mousemove`, a
 * press "squash" and an accent-coloured expanding ring on `mousedown`. Position survives
 * navigations via sessionStorage.
 */
export function cursorOverlayScript(accent: string = '#dc2626'): string {
    return `
(() => {
    if (window.__demoCursor) return;
    window.__demoCursor = true;

    const SIZE = 44;          // px
    const ACCENT = ${JSON.stringify(accent)};
    // Arrow tip in the 24-unit viewBox is (5.5, 2.5); this is where the pointer actually is.
    const TIP_X = 5.5 / 24 * SIZE;
    const TIP_Y = 2.5 / 24 * SIZE;
    const style = document.createElement('style');
    style.textContent = \`
        #__demo-cursor { position: fixed; left: 0; top: 0; width: \${SIZE}px; height: \${SIZE}px; z-index: 2147483647;
            pointer-events: none; will-change: transform;
            filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)) drop-shadow(0 8px 16px rgba(0,0,0,.25)); }
        /* The press squash scales the SVG child about the arrow tip. Never scale the
           container: its scale composes outside the positioning translate and drags the
           cursor toward the page origin while it animates. */
        #__demo-cursor svg { display: block; transform-origin: \${TIP_X}px \${TIP_Y}px; }
        #__demo-cursor.pressed svg { animation: __demo-press .22s ease-out; }
        @keyframes __demo-press { 0% { transform: scale(1) } 40% { transform: scale(.82) } 100% { transform: scale(1) } }
        #__demo-ripple, #__demo-ripple2 { position: fixed; border-radius: 50%; z-index: 2147483646; pointer-events: none;
            transform: translate(-50%, -50%) scale(.2); opacity: 0; }
        #__demo-ripple { width: 84px; height: 84px; border: 4px solid \${ACCENT}; background: color-mix(in srgb, \${ACCENT} 22%, transparent); }
        #__demo-ripple2 { width: 84px; height: 84px; border: 2px solid color-mix(in srgb, \${ACCENT} 90%, transparent); }
        #__demo-ripple.go { animation: __demo-ripple .55s cubic-bezier(.2,.7,.3,1) forwards; }
        #__demo-ripple2.go { animation: __demo-ripple .8s .08s cubic-bezier(.2,.7,.3,1) forwards; }
        @keyframes __demo-ripple { 0% { transform: translate(-50%,-50%) scale(.2); opacity: 1 }
            100% { transform: translate(-50%,-50%) scale(1.25); opacity: 0 } }
    \`;

    const cursor = document.createElement('div');
    cursor.id = '__demo-cursor';
    cursor.innerHTML = '<svg viewBox="0 0 24 24" width="' + SIZE + '" height="' + SIZE + '">'
        + '<path d="M5.5 2.5v17.4l4.6-4.4 2.9 6.5 3-1.3-2.9-6.4h6.4z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const ripple = document.createElement('div');
    ripple.id = '__demo-ripple';
    const ripple2 = document.createElement('div');
    ripple2.id = '__demo-ripple2';

    let saved = { x: -100, y: -100 };
    try { saved = JSON.parse(sessionStorage.getItem('__demoCursorPos') || 'null') || saved; } catch {}

    const place = (x, y) => {
        cursor.style.transform = 'translate(' + (x - TIP_X) + 'px,' + (y - TIP_Y) + 'px)';
        try { sessionStorage.setItem('__demoCursorPos', JSON.stringify({ x, y })); } catch {}
    };

    const mount = () => {
        const host = document.documentElement;
        host.appendChild(style); host.appendChild(ripple2); host.appendChild(ripple); host.appendChild(cursor);
        place(saved.x, saved.y);
    };
    if (document.documentElement) mount(); else document.addEventListener('DOMContentLoaded', mount);

    document.addEventListener('mousemove', (e) => place(e.clientX, e.clientY), true);
    document.addEventListener('mousedown', (e) => {
        for (const r of [ripple, ripple2]) {
            r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
            r.classList.remove('go'); void r.offsetWidth; r.classList.add('go');
        }
        cursor.classList.remove('pressed'); void cursor.offsetWidth; cursor.classList.add('pressed');
    }, true);
})();
`
}

/**
 * Hides local-only UI (debug toolbars, environment badges, dev-login buttons)
 * in every recorded page. Selectors come from COMMON_DEV_CHROME plus the
 * project's `record.hideSelectors` in demo.config.json.
 */
export function hideDevChromeScript(selectors: string[]): string {
    if (selectors.length === 0) {
        return ''
    }
    const css = selectors.join(', ') + ' { display: none !important; }'

    return `
(() => {
    const style = document.createElement('style');
    style.textContent = ${'${JSON.stringify(css)}'};
    const mount = () => document.head.appendChild(style);
    if (document.head) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
`
}
