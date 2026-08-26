# Audio credits and licences

All audio in this folder is free to use. Two of the three sources are CC0 (no
attribution required); the music is CC BY 4.0 and **must** be credited if the
game is distributed or submitted to a jam.

## Music — attribution REQUIRED

`music/golden-hour-stroll.mp3` is "Carefree" by Kevin MacLeod, re-encoded to
128 kbps stereo. Licensed under CC BY 4.0. The credit below is the wording the
author asks for, and it needs to appear somewhere the player or judge can see
it (end screen, itch.io page, or README):

```
Carefree
Kevin MacLeod (incompetech.com)
Licensed under Creative Commons: By Attribution 4.0
https://creativecommons.org/licenses/by/4.0/
```

Source: https://incompetech.com/music/royalty-free/

## Sound effects — CC0, no attribution required

| Files | Source | Licence |
| --- | --- | --- |
| `sfx/footstep-*`, `sfx/ordinance-stamp*`, `sfx/axe-hit-wood`, `sfx/wood-crash`, `sfx/metal-crash` | Kenney — Impact Sounds | CC0 |
| `sfx/axe-chop`, `sfx/mailbox-latch`, `sfx/envelope-paper`, `sfx/pickup-tool`, `sfx/pickup-soft`, `sfx/next-day-sting` | Kenney — RPG Audio | CC0 |
| `sfx/ui-*`, `sfx/ordinance-reveal`, `sfx/mail-delivered`, `sfx/victory`, `sfx/next-day-type` | Kenney — Interface Sounds | CC0 |
| `sfx/cat-meow`, `sfx/cat-meow-hungry` | "Cat Purr & Meow" by kerzoven, OpenGameArt | CC0 |
| `ambience/evening-crickets.mp3` | "Crickets Ambient Noise - loopable" by wolfgang, OpenGameArt | CC0 |

Sources: https://kenney.nl/assets (Impact Sounds, RPG Audio, Interface Sounds),
https://opengameart.org/content/cat-purr-meow,
https://opengameart.org/content/crickets-ambient-noise-loopable

Crediting Kenney and the OpenGameArt authors is not required, but it is polite.

## Encoding

Source packs ship as OGG/WAV. Everything here was converted to MP3 because the
engine's asset classifier only recognises `.mp3` and `.wav` as audio. Effects
are **mono** on purpose — `THREE.PositionalAudio` can only pan mono sources, so
a stereo effect would not spatialise. Music and ambience stay stereo.
