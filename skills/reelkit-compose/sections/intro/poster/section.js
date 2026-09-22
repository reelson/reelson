// Frame 0 = the poster: letters, line, sub and title are big (130%) and half-transparent,
// the letters spread a little. Then everything "breathes" down into place (sine.inOut,
// letters 60 ms apart from the centre, no snap anywhere), the subtitle and chip rise in,
// the card holds, and at section.exit the whole stack leaves through the top while the
// recording arrives from below on the same belt.
// The from-states below ARE the poster — keep them sharp (no blur, no `later` at t=0).
const c0 = section.start + 0.08;
// Portrait has no room to spare at the sides: a gentler poster that still fits the width.
const narrow = DEMO.layout.format === 'portrait';
const big = narrow ? 1.08 : 1.3;
const spread = narrow ? 8 : 26;
tl.fromTo('#intro .l', { scale: big, opacity: 0.6, x: (i, el, all) => (i - (all.length - 1) / 2) * spread },
  { scale: 1, opacity: 1, x: 0, duration: 1.4, ease: 'sine.inOut', stagger: { each: 0.06, from: 'center' } }, c0);
tl.fromTo('#intro .brand-line', { scaleX: big, opacity: 0.6 }, { scaleX: 1, opacity: 1, duration: 1.3, ease: 'sine.inOut' }, c0 + 0.25);
tl.fromTo('#intro .brand-sub', { scale: big, opacity: 0.6 }, { scale: 1, opacity: 1, duration: 1.3, ease: 'sine.inOut' }, c0 + 0.35);
tl.fromTo('#intro .title', { scale: big, opacity: 0.65 }, { scale: 1, opacity: 1, duration: 1.4, ease: 'sine.inOut' }, c0 + 0.2);
tl.fromTo('#intro .stack', { y: 0 }, { y: -30, duration: 1.2, ease: 'power2.out' }, c0);
tl.fromTo('#intro .top', { y: -24 }, { y: 0, duration: 1.3, ease: 'power2.out' }, c0);
tl.fromTo('#intro .bottom', { y: 33 }, { y: 0, duration: 1.3, ease: 'power2.out' }, c0 + 0.15);
tl.fromTo('#intro .subtitle', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', ...later }, section.start + 0.9);
tl.fromTo('#intro .meta', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', ...later }, section.start + 1.05);
tl.fromTo('#intro .stack', { y: -30 }, { y: -(DEMO.layout.stage.height + 70), duration: 0.9, ease: 'power3.inOut', ...later }, section.exit);
stage.enter(section.exit, 'belt');

gsap.set(['#intro .subtitle', '#intro .meta'], { opacity: 0 });
