// Head rises, chips pop in one after another, then the card fades.
const chips = document.querySelector('#recap .chips');
const steps = DEMO.callouts.slice(0, section.maxSteps);
const rows = steps.map((c, i) => {
  const el = node('div', 'chip');
  el.append(node('span', 'n', String(i + 1)));
  // Two-actor videos: the role tag opens each role's first chip.
  if (c.group && c.group !== steps[i - 1]?.group) el.append(node('span', 'who', c.group));
  el.append(node('span', '', c.text));
  return chips.appendChild(el);
});
const r0 = section.start;
tl.fromTo('#recap', { opacity: 0 }, { opacity: 1, duration: FADE, ease: 'power2.inOut', ...later }, r0);
tl.fromTo('#recap .eyebrow', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', ...later }, r0 + 0.05);
tl.fromTo('#recap .title', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', ...later }, r0 + 0.12);
tl.fromTo('#recap .accent', { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: 'power3.inOut', ...later }, r0 + 0.35);
rows.forEach((row, i) => {
  tl.fromTo(row, { opacity: 0, y: 18, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: 'back.out(1.6)', ...later }, r0 + 0.4 + i * 0.08);
});
tl.fromTo('#recap', { opacity: 1 }, { opacity: 0, duration: FADE, ease: 'power2.in', ...later }, r0 + section.duration - FADE);

gsap.set(['#recap', '#recap .eyebrow', '#recap .title', ...rows], { opacity: 0 });
gsap.set('#recap .accent', { scaleX: 0 });
