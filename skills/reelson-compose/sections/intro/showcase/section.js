// Frame 0 = the poster: the canvas, brand row and title already legible (words at 75%, a
// little low), the peek of the demo's last seconds tilted on the right. The words settle one
// after another, subtitle and chip rise in, the peek turns slowly toward the viewer while its
// footage plays. At section.exit the text slides off left, the peek straightens and grows
// toward the middle as the canvas fades, and the recording zooms in behind it.
// The from-states below ARE the poster — keep them sharp (no blur, no `later` at t=0).
const title = document.querySelector('#intro .title');
title.replaceChildren(...title.dataset.title.split(/\s+/).filter(Boolean).map((w) => node('span', 'w', w)));

// Fit the peek to the footage's shape inside its box.
const shot = document.querySelector('#intro .shot'), peek = document.querySelector('#intro .peek');
const fw = {{FOOTAGE_W}}, fh = {{FOOTAGE_H}};
const k = Math.min((shot.offsetWidth * 0.94) / fw, (shot.offsetHeight * 0.82) / fh);
peek.style.width = Math.round(fw * k) + 'px';
peek.style.height = Math.round(fh * k) + 'px';

const s0 = section.start + 0.06;
tl.fromTo('#intro .glow', { x: 0, y: 0, scale: 1 }, { x: -60, y: 30, scale: 1.08, duration: section.duration, ease: 'sine.inOut' }, section.start);
tl.fromTo('#intro .brand .l', { opacity: 0.6, y: 8 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.03 }, s0);
tl.fromTo('#intro .brand-sub', { opacity: 0.6 }, { opacity: 1, duration: 0.7, ease: 'sine.inOut' }, s0 + 0.15);
tl.fromTo('#intro .title .w', { opacity: 0.75, y: 26 }, { opacity: 1, y: 0, duration: 0.8, ease: 'power4.out', stagger: 0.09 }, s0 + 0.05);
tl.fromTo('#intro .subtitle', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', ...later }, section.start + 0.7);
tl.fromTo('#intro .meta', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', ...later }, section.start + 0.9);
tl.fromTo('#intro .peek', { rotateY: -16, rotateX: 4, scale: 0.94, x: 30 },
  { rotateY: -9, rotateX: 2, scale: 1, x: 0, duration: section.exit - section.start - 0.3, ease: 'sine.out' }, section.start);

// The hand-over: the text slides off left, the peek straightens and lands exactly on the
// recording's frame, the canvas fades, and the recording fades in under the peek.
const box = (el) => { let x = 0, y = 0, e = el; while (e && e.id !== 'root') { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; } return { x, y, w: el.offsetWidth, h: el.offsetHeight }; };
const from = box(peek), to = box(document.getElementById('frame'));
const land = { x: to.x + to.w / 2 - (from.x + from.w / 2), y: to.y + to.h / 2 - (from.y + from.h / 2), scale: to.w / from.w };
const out = section.exit - 0.4;
tl.fromTo('#intro .text', { x: 0, opacity: 1 }, { x: -120, opacity: 0, duration: 0.4, ease: 'power2.in', ...later }, out);
tl.fromTo('#intro .peek', { rotateY: -9, rotateX: 2, scale: 1, x: 0, y: 0, borderRadius: 22 },
  { rotateY: 0, rotateX: 0, scale: land.scale, x: land.x, y: land.y, borderRadius: 22 / land.scale, duration: 0.75, ease: 'power3.inOut', ...later }, out + 0.1);
tl.fromTo('#intro .canvas', { opacity: 1 }, { opacity: 0, duration: 0.5, ease: 'power2.inOut', ...later }, section.exit);
stage.enter(section.exit + 0.3, 'fade');
tl.fromTo('#intro .peek', { opacity: 1 }, { opacity: 0, duration: 0.4, ease: 'power1.inOut', ...later }, section.exit + 0.55);

gsap.set(['#intro .subtitle', '#intro .meta'], { opacity: 0 });
