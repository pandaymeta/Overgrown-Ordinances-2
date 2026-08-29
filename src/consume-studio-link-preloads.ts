/**
 * Sandbox Studio injects `<link rel="preload">` tags for shell assets (e.g.
 * genesys-bg.jpg) and project resources. Chrome warns when they are not
 * consumed within ~3s of window load. Touch each hint as soon as the game
 * bundle evaluates so the browser counts them as used.
 */
export function consumeStudioLinkPreloads(): void {
  if (typeof document === 'undefined') {
    return;
  }

  const links = document.head.querySelectorAll('link[rel="preload"][href]');
  for (const link of links) {
    const href = link.getAttribute('href');
    if (!href) {
      continue;
    }
    const as = link.getAttribute('as') ?? '';
    try {
      if (
        as === 'image'
        || as === 'font'
        || /\.(?:png|jpe?g|webp|gif|avif|svg|woff2?|ttf|otf)(\?|$)/i.test(href)
      ) {
        const img = new Image();
        img.decoding = 'async';
        img.src = href;
        continue;
      }
      void fetch(href, {
        credentials: 'same-origin',
        cache: 'force-cache',
        mode: 'cors',
      }).catch(() => undefined);
    } catch {
      // Best-effort — Studio may inject cross-origin hints we cannot read.
    }
  }
}

consumeStudioLinkPreloads();
