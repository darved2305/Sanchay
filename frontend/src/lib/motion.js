/*
 * Shared motion presets (Framer Motion). Restrained, product-grade motion:
 * short fades and small rises. The global prefers-reduced-motion rule in
 * index.css collapses these to near-instant for users who ask for it.
 */

export const pageEnter = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.26, ease: 'easeOut' },
};

export const staggerParent = {
  animate: { transition: { staggerChildren: 0.05 } },
};

export const cardEnter = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.24, ease: 'easeOut' },
};

export const heroReveal = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
};

export const heroRevealDelayed = (delay = 0.12) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] },
});

export const modalEnter = {
  initial: { opacity: 0, scale: 0.985 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.985 },
  transition: { duration: 0.18, ease: 'easeOut' },
};

export const tapPress = { scale: 0.98 };
