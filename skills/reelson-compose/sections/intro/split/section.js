// Frame 0 = the poster: the panel is already in place with its wordmark a little big and
// 60% transparent, the title legible at 65% slightly to the right. Both settle, subtitle
// and chip rise in, the card holds; at section.exit the panel slides out left, the text
// out right, and the recording grows out of the middle.
// The from-states below ARE the poster — keep them sharp (no blur, no `later` at t=0).
const s0 = section.start + 0.08;
tl.fromTo('#intro .panel .wordmark', { scale: 1.18 }, { scale: 1, duration: 1.3, ease: 'sine.inOut' }, s0);
tl.fromTo('#intro .panel .l', { opacity: 0.6 }, { opacity: 1, duration: 1.1, ease: 'sine.inOut', stagger: { each: 0.05, from: 'center' } }, s0);
tl.fromTo('#intro .brand-line', { scaleX: 0.4 }, { scaleX: 1, duration: 1.1, ease: 'power3.inOut' }, s0 + 0.25);
tl.fromTo('#intro .brand-sub', { opacity: 0.6 }, { opacity: 1, duration: 1.0, ease: 'sine.inOut' }, s0 + 0.3);
tl.fromTo('#intro .title', { opacity: 0.65, x: 40 }, { opacity: 1, x: 0, duration: 1.3, ease: 'sine.inOut' }, s0 + 0.1);
tl.fromTo('#intro .subtitle', { opacity: 0, x: 30 }, { opacity: 1, x: 0, duration: 0.6, ease: 'power3.out', ...later }, section.start + 0.8);
tl.fromTo('#intro .meta', { opacity: 0, x: 24 }, { opacity: 1, x: 0, duration: 0.5, ease: 'power3.out', ...later }, section.start + 1.0);
// The panels are mostly gone before the frame grows in, so the text never shows through it.
tl.fromTo('#intro .panel', { x: 0 }, { x: -900, duration: 0.7, ease: 'power3.inOut', ...later }, section.exit - 0.25);
tl.fromTo('#intro .text', { x: 0, opacity: 1 }, { x: 1300, opacity: 0, duration: 0.7, ease: 'power3.inOut', ...later }, section.exit - 0.25);
stage.enter(section.exit + 0.2, 'zoom');

gsap.set(['#intro .subtitle', '#intro .meta'], { opacity: 0 });
