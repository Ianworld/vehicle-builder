# Vehicle Builder

Build a vehicle out of grid parts, then race two of them head to head in split
screen. Static site, no build step, no backend.

Designed for a young kid on both a touchscreen and a laptop:

- **No fail states.** Vehicles are indestructible, auto-right when flipped, and
  every race finishes.
- **The player cannot read yet**, so every button leads with a graphic and the
  word is only a backup for adults. Part trays show sprites, vehicle pickers
  show the vehicle, and each track chip draws that track's real elevation
  profile.
- **Leaving the builder always saves.** Both the Save button and the back arrow
  save and return to the garage; seeing the vehicle appear there is the
  confirmation. An empty vehicle is discarded rather than saved as junk.
- Big touch targets, undo everywhere, no typing required.

## Run it locally

ES modules can't load over `file://`, so it needs a static server — but nothing
in the app depends on that server existing.

```bash
python3 -m http.server 8700 --directory "vehicle builder"
```

Then open <http://localhost:8700/index.html>.

There is also a `vehicle-builder` entry in `../.claude/launch.json`.

Sprite review page: <http://localhost:8700/src/art/sheet.html>

## Deploy to GitHub Pages

This folder is the site. No build step, no Actions workflow — push it and point
Pages at the branch.

Three constraints are baked in and must stay that way:

1. **Every path is relative.** Pages serves from `https://<user>.github.io/<repo>/`,
   a subpath. A root-absolute path like `/src/main.js` works on localhost and
   404s in production. Verified by serving from a nested path locally.
2. **Storage keys are namespaced `vb:`.** `<user>.github.io` is a single origin
   shared by every repo you host there.
3. **`.nojekyll` is present**, so Pages doesn't run a Jekyll pass that ignores
   `_`-prefixed files.

## Architecture

```
src/art/     palette -> rasterizer -> sprites -> atlas     (see "Art" below)
src/game/    parts catalog, vehicle model, codec, storage, share
src/ui/      pointer input, builder screen, garage screen, thumbnails
```

### Art: sprites are code

Sprites are **geometric primitives against a locked 16-color palette**,
rasterized to a hard-edged pixel grid at load — not generated raster images.

For 32px grid tiles this beats an image model. Palette lock becomes structural
instead of prompted (a sprite physically cannot use an off-palette color), grid
alignment is exact by construction, and changing a part is a two-line edit
rather than a regenerate-and-clean cycle.

The consistency trick is that **style lives in the rasterizer, not in each
sprite**: one pass adds a 1px ink outline plus a bevel to every sprite
identically. The bevel infers direction from relative luminance — a region
darker than its neighbour reads as a recessed pocket and shades at the top, a
lighter region reads as a raised boss and highlights at the top. That single
rule is what makes independently-authored sprites look like one artist.

Two gotchas worth remembering:

- `spriteCanvas()` returns a **shared cached** canvas for `drawImage`. Appending
  it to the DOM moves the same node between parents. Use `spriteCopy()` for DOM.
- Polygon coordinates are **continuous, not pixel indices**: a shape covering a
  32px sprite spans `0..32`. Using `0..31` silently drops the last row/column.

### Persistence

Static hosting means the browser is the only place a vehicle can live.

| Layer | Role |
|---|---|
| IndexedDB | Primary store. localStorage is the obvious choice and the wrong one — mobile browsers clear it under storage pressure. |
| `navigator.storage.persist()` | Asks the browser to exempt the origin from eviction. Requested on boot. |
| localStorage mirror | Cheap redundant copy; covers IndexedDB being blocked. |
| `reconcile()` | Runs at boot and makes the two stores agree **in both directions**, so a wipe of either one self-heals instead of silently leaving a single copy. |
| Export / import | `garage.json`. The honest backup, since browser storage is per-device however durable it is. |
| Share links | `#v=<base64>` encodes a whole vehicle in the URL. A third backup path, and how a vehicle moves between devices or people with no backend. |

A realistic 10–30 part vehicle is a 100–400 character link. A completely full
14x9 grid is ~1750 characters, still inside practical URL limits.

### Physics

planck.js 1.5 (vendored, MIT). One rigid chassis body with a fixture per part;
wheels are separate circle bodies on `WheelJoint`s, which give a motor and
spring suspension in one joint. The plow is a real triangular polygon — a box
there would do nothing.

Two things that took real tuning, both worth knowing before changing numbers:

- **Torque fights climbing against wheelies.** Enough torque to climb a 33°
  ledge is enough to loop the vehicle over backwards. Resolved with an
  anti-wheelie damper keyed on *rotation rate*, not hull angle — a wheelie
  spins up fast, whereas a vehicle parked on a 35° slope sits at the same angle
  but barely rotates, so genuine hill climbing is left alone.
- **"Never stuck" is a stronger promise than "never upside down."** Vehicles
  beached nose-up at 80–90° with their wheels spinning in the air, nowhere near
  a flip. Recovery therefore watches *forward progress*, with fast paths for
  being inverted — including inverted **at speed**, since a vehicle can slide
  20 m on its roof while still technically making progress.

Plow height matters: mounted in the wheel-contact row it becomes a ground
anchor and pins the vehicle. It belongs one row above the wheels.

Testbed: <http://localhost:8700/src/game/testbed.html> (pick a vehicle and
track, spawn upside-down, slow-mo). It exposes `__step(seconds)` and
`__reset(vehicle, track, upsideDown)` for headless verification, because some
embedded browser panes never fire `requestAnimationFrame`.

### Icons

`node tools/make-favicon.mjs` regenerates `favicon.ico`, `favicon-32.png`,
`favicon-64.png` and `apple-touch-icon.png` from the same sprite DSL as the
game art, so the icon cannot drift off-palette. The design is authored directly
at 32px with deliberately fewer and higher-contrast shapes than the in-game
sprites -- at icon size a recessed panel and a mid-grey wedge both just read as
"dark blob". The `.ico` matters: browsers request `/favicon.ico` implicitly
whatever the `<link>` tags say.

### Stability

Vehicles tip because of **shape**, not because the engine models them wrongly:
planck's rotational inertia matches an independent analytic calculation to
0.5-3.5%. What matters is centre-of-mass height divided by wheelbase. A real
car is about 0.19; the original starter vehicles were 0.54-0.78.

The builder therefore *shows* the centre of mass -- a dot, a drop line, and a
bar spanning the wheel contact points -- coloured green / amber / red by that
ratio. Rather than silently lowering the CoM in code (which works, but deletes
the reason to put the Weight block at the bottom), the player is given the
information and can fix it themselves.

One counterintuitive result worth keeping: **a longer wheelbase is not always
more stable.** Plodder at 3.0m spanned The Gap's valley and pivoted into a
flip; shortening it to 2.0m gave zero flips and was faster on two tracks.

Rebuilding the three starters low and wide, with no physics changes at all,
took the nine-run regression from 12 tipovers / 15 recovery assists / 36.0s
median lap to **0 / 5 / 28.0s**.

Note `getInertia()` is measured about the body ORIGIN, not the centre of mass
-- 2.5x to 3.1x larger here, and the factor varies per design. Control torque
must use `inertiaAboutCoM()` in `physics.js` so gains mean the same thing on
every vehicle.

### Tracks

Seven tracks. Beyond terrain shape they vary along axes that make different
parts win:

| | what it tests |
|---|---|
| Rolling Hills | nothing; a first race |
| Boulder Pass | loose obstacles and climbable ledges |
| The Gap | jumps, carrying speed |
| Slick Pass | **ground material** — ice, tarmac |
| Rockslide | **piles of rock to shove**, plus sand |
| Low Road | **height limit** — beams overhead |
| Old Bridge | **weight limit** — planks that give way |

**Materials** (`SURFACES` in `track.js`) scale wheel grip and rolling
resistance, and act on WHEELS ONLY. That is what makes the drive parts feel
different: a jet pushes on the chassis and does not care what is underneath, and
a tread starts from friction 2.4 against a small wheel's 1.1, so ice barely
troubles it. Two things learned tuning this:

- Ice on the *flat* does nothing. A wheel there only needs enough grip to beat
  air drag, so slippery flat ground is scenery. Ice has to sit where traction
  decides the outcome — but not on steps either, because horizontal thrust
  cannot climb a wall and that punishes jets just as hard. Flat, fast ice with
  the steps on the grippy sections is what separates them.
- Jets had **no terminal velocity at all** — nothing opposed thrust, so a jet
  sled beat every wheeled build on six of seven tracks. Air drag (quadratic,
  scaled by vehicle height so tall builds pay more) plus a large thrust cut
  fixed it.

**Breakable features** are deliberately scripted, not emergent: a plank gives
way above a mass limit, a beam gives way to a hull taller than its clearance.
"Too heavy" and "too tall" have to be predictable enough for a child to learn,
and an impulse threshold is neither legible nor repeatable. Both cost a lot of
time without ever ending a race — the gully under a bridge is shallow.

Track cards on the race screen are **real renders**: each builds an actual
world and draws it with the same `renderView` the race uses, so the picture
cannot drift from what you will drive through.

### Racing

Two **independent worlds**, one per racer, each holding its own copy of the
track. Neither can shove the other and neither is perturbed by the other's
debris, so a race is fair and repeatable — and split screen falls out for free.

Split direction follows the viewport: portrait stacks the panes, anything
landscape puts them side by side. A side-scroller needs WIDE panes; two 187px
columns on a phone would be unplayable.

The action button fires **every special on the vehicle at once**, each on its
own cooldown — one rule a kid can predict. Keys are `A` (P1) and `L` (P2).

When the leader crosses, the trailing vehicle keeps driving for six more
seconds, because crossing the line is the fun part even when you have lost.
It is then reported by distance reached, never as "did not finish".

The frame loop is rAF with a **watchdog**: if rAF goes quiet for 120 ms a timer
takes over. An earlier version latched a `rafSeen` flag on the first frame,
which permanently disabled the fallback and stalled the race. The loop also
holds while `document.hidden`, so a backgrounded tab does not crawl through a
race in slow motion.

## Status

- [x] Phase 1 — art system
- [x] Phase 2 — builder + persistence
- [x] Phase 3 — physics (planck.js, one rigid chassis + wheel joints)
- [x] Phase 4 — split-screen race
- [ ] Phase 5 — polish

Deferred: part breakage. The chassis is one rigid body today; adding breakage
later means splitting it into weld-jointed sub-bodies, not a rewrite.
