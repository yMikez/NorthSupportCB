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

**Look at every face before shipping it.** The generator draws from the full
range of its training data, which includes children — two of the first eight
faces pulled for this repo were kids. `--only <id> --force` re-rolls the ones
that don't fit.

The faces are also drawn independently of the names, so a pairing may read
oddly. Re-roll the photo, or rename the agent in `lib/agents.ts` — whichever
suits the desk you want to present.

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

Edit `SUPPORT_AGENTS` in `lib/agents.ts`; the fetch script reads the ids straight
out of that file. Names are first-name-only, and the `gradient` pair is the
no-photo fallback — keep those in the blue/indigo/teal range, since green means
"online" and amber/red mean "something is wrong" everywhere else in this UI.
