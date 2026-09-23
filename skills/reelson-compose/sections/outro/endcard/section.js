// Waits out the recap's cross-fade (0.3 s) so nothing lands on its text, then letters rise
// from the centre, the line wipes open, title / subtitle / chip follow. Then it holds with a barely-there drift and ends
// fully visible: the paused last frame is a readable end card.
const e0 = section.start + 0.3;
tl.fromTo('#outro .l', { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out', stagger: { each: 0.05, from: 'center' }, ...later }, e0 + 0.1);
tl.fromTo('#outro .brand-line', { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: 'power3.inOut', ...later }, e0 + 0.45);
tl.fromTo('#outro .title', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', ...later }, e0 + 0.6);
tl.fromTo('#outro .subtitle', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', ...later }, e0 + 0.8);
tl.fromTo('#outro .meta', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', ...later }, e0 + 0.95);
tl.fromTo('#outro .card', { scale: 1 }, { scale: 1.02, duration: Math.max(0.5, section.duration - 1.9), ease: 'sine.inOut', ...later }, e0 + 1.6);

gsap.set(['#outro .l', '#outro .title', '#outro .subtitle', '#outro .meta'], { opacity: 0 });
gsap.set('#outro .brand-line', { scaleX: 0 });
