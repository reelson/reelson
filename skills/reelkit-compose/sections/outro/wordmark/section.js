// Letters drift in from farther out and scale up from 0.88, the line wipes from the left,
// then everything zooms out gently at the very end and settles at 15% opacity: the last
// frame still shows the wordmark (house rule), never empty.
const b0 = section.start;
tl.fromTo('#outro .l', { opacity: 0, x: (i, el, all) => (i - all.length / 2) * 44, scale: 0.88, filter: 'blur(12px)' },
  { opacity: 1, x: 0, scale: 1, filter: 'blur(0px)', duration: 1.1, ease: 'power3.out', stagger: { each: 0.06, from: 'center' }, ...later }, b0 + 0.1);
tl.fromTo('#outro .brand-line', { scaleX: 0, transformOrigin: 'left center' }, { scaleX: 1, duration: 0.9, ease: 'power3.inOut', ...later }, b0 + 0.7);
tl.fromTo('#outro .brand-sub', { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out', ...later }, b0 + 0.95);
tl.fromTo('#outro', { opacity: 1, scale: 1 }, { opacity: 0.15, scale: 0.96, duration: 0.8, ease: 'power2.in', ...later }, b0 + section.duration - 0.8);

gsap.set(['#outro .l', '#outro .brand-sub'], { opacity: 0 });
gsap.set('#outro .brand-line', { scaleX: 0 });
