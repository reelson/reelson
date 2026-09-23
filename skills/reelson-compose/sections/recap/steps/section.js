// Left block rises, steps cascade in on the right, then the card fades.
const list = document.querySelector('#recap .steps');
const steps = DEMO.callouts.slice(0, section.maxSteps); // the card holds this many
if (steps.length > 8) list.classList.add('dense');
// Two-actor videos: callouts carry a `group` (the role from the hand-off card); each
// role gets its own titled list, numbering continues across them.
const rows = [];
steps.forEach((c, i) => {
  if (c.group && c.group !== steps[i - 1]?.group) {
    rows.push(list.appendChild(node('div', 'group', c.group)));
  }
  const el = node('div', 'step');
  el.append(node('span', 'n', String(i + 1)), node('span', '', c.text));
  rows.push(list.appendChild(el));
});
const r0 = section.start;
tl.fromTo('#recap', { opacity: 0 }, { opacity: 1, duration: FADE, ease: 'power2.inOut', ...later }, r0);
tl.fromTo('#recap .eyebrow', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', ...later }, r0 + 0.1);
tl.fromTo('#recap .title', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', ...later }, r0 + 0.2);
tl.fromTo('#recap .accent', { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: 'power3.inOut', ...later }, r0 + 0.45);
rows.forEach((row, i) => {
  tl.fromTo(row, { opacity: 0, x: 36 }, { opacity: 1, x: 0, duration: 0.45, ease: 'power3.out', ...later }, r0 + 0.5 + i * 0.1);
});
tl.fromTo('#recap', { opacity: 1 }, { opacity: 0, duration: FADE, ease: 'power2.in', ...later }, r0 + section.duration - FADE);

gsap.set(['#recap', '#recap .eyebrow', '#recap .title', ...rows], { opacity: 0 });
gsap.set('#recap .accent', { scaleX: 0 });
