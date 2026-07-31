# Agent photos

Each conversation is assigned an agent from the roster in [`lib/agents.ts`](../../lib/agents.ts).
Which one is derived from the conversation id, so the same chat always shows the
same person — on the page, in the system prompt, and in the handover email.

The `.jpg` files here are **synthetic faces**: GAN output, not photographs of
anyone. See "Why not real photos" below before replacing them.

## Refreshing them

```
npm run agents:photos                          # agents with no photo yet
npm run agents:photos -- --force               # a new face for everyone
npm run agents:photos -- --only theo --force   # re-roll one agent
```

**Look at every face before shipping it**, on two counts.

**Gender.** Every agent carries a `gender` in `lib/agents.ts` and the photo has
to match it — a "Marcus" with a woman's face reads as a stock-image front, which
is the one impression a support desk cannot afford. The script prints what each
face has to be (`← must be male`) but cannot enforce it: the default generator
takes no parameters and returns whatever it drew, so expect to re-roll about
half of them. Sources that filter by gender do exist; the ones checked so far
licence their free tier for *personal use only* and stamp a watermark across the
image, which rules them out here. If you find a properly licensed one, point
`--source` at it with `{gender}` in the URL and the matching becomes automatic.

**Age.** The generator draws from the full range of its training data, which
includes children — two of the first eight faces pulled for this repo were kids.

`--only <id> --force` re-rolls whatever doesn't fit. Swapping two files that are
each right for the *other* agent works too, and costs nothing.

## Using your own photos

Drop a file named after the agent's `id`:

```
public/agents/maya.jpg     public/agents/elena.jpg
public/agents/julian.jpg   public/agents/marcus.jpg
public/agents/noor.jpg     public/agents/sofia.jpg
public/agents/ravi.jpg     public/agents/theo.jpg
```

Picked up on the next request — no build step, no code change. An agent with no
file falls back to their initial on a coloured circle, so a partial set is fine.

Square, head-and-shoulders, JPEG. Size doesn't matter much: `AgentAvatar` runs
them through `next/image`, so the browser gets a couple of KB whatever you drop
in. It also zooms slightly and frames on the upper half — that exists to push
the generator's corner watermark out of the circle, so check your own crops
still look centred if you swap the source.

## Why not real photos

These images are shown to a customer as the person handling their case. A real,
identifiable face there misrepresents someone who never agreed to it, and stock
licences generally forbid exactly this use — presenting the model as staff or as
endorsing the business. Synthetic faces get the same result with nobody
depicted.

If you do use photographs of real people, they should be your own team, or
people who agreed to appear this way.

One caveat with the synthetic ones: a GAN can occasionally produce a face close
to someone in its training data. If a result looks like a specific person you
recognise, re-run with `--force`.

## Changing the roster

Edit `SUPPORT_AGENTS` in `lib/agents.ts`; the fetch script reads the roster
straight out of that file and refuses to run if an entry has no `gender`. Names
are first-name-only. Nothing in the product uses `gender` beyond picking the
face — the customer is never told "he" or "she" — so for a name that works
either way, pin whichever you want the desk to show.

The `gradient` pair is the no-photo fallback — keep those in the blue/indigo/teal
range, since green means "online" and amber/red mean "something is wrong"
everywhere else in this UI.
