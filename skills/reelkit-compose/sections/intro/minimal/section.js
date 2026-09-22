// Frame 0 = the poster: brand row and title already legible (70%), a little low. They
// settle up into place, the accent line grows, subtitle and chip rise in, the block holds,
// then it softly lifts and fades while the recording fades in behind it.
// The from-states below ARE the poster — keep them sharp (no blur, no `later` at t=0).
const m0 = section.start + 0.08;
tl.fromTo('#intro .brand .l', { opacity: 0.6, y: 10 }, { opacity: 1, y: 0, duration: 0.9, ease: 'sine.inOut', stagger: 0.04 }, m0);
tl.fromTo('#intro .brand-sub', { opacity: 0.6 }, { opacity: 1, duration: 0.9, ease: 'sine.inOut' }, m0 + 0.2);
tl.fromTo('#intro .title', { opacity: 0.7, y: 34 }, { opacity: 1, y: 0, duration: 1.2, ease: 'sine.inOut' }, m0);
tl.fromTo('#intro .accent', { scaleX: 0.3 }, { scaleX: 1, duration: 1.0, ease: 'power3.inOut' }, m0 + 0.2);
tl.fromTo('#intro .subtitle', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', ...later }, section.start + 0.6);
tl.fromTo('#intro .meta', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', ...later }, section.start + 0.8);
tl.fromTo('#intro .block', { opacity: 1, y: 0, filter: 'blur(0px)' },
  { opacity: 0, y: -26, filter: 'blur(8px)', duration: 0.5, ease: 'power2.in', ...later }, section.exit - 0.5);
stage.enter(section.exit, 'fade');

gsap.set(['#intro .subtitle', '#intro .meta'], { opacity: 0 });
