// Waits out the recap's cross-fade (0.3 s) so the brand never lands on its text, then:
// letters slide in from the left, the divider grows, the title follows, a short hold,
// and everything settles at 15% opacity: the last frame still shows the brand.
const o0 = section.start + 0.3;
tl.fromTo('#outro .l', { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 0.6, ease: 'power3.out', stagger: 0.03, ...later }, o0);
tl.fromTo('#outro .divider', { scaleY: 0 }, { scaleY: 1, duration: 0.4, ease: 'power3.inOut', ...later }, o0 + 0.2);
tl.fromTo('#outro .right', { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.5, ease: 'power3.out', ...later }, o0 + 0.3);
tl.fromTo('#outro .row', { opacity: 1, scale: 1 }, { opacity: 0.15, scale: 0.97, duration: 0.6, ease: 'power2.in', ...later }, section.start + section.duration - 0.6);

gsap.set(['#outro .l', '#outro .right'], { opacity: 0 });
gsap.set('#outro .divider', { scaleY: 0 });
