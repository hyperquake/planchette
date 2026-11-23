# Running interfaces on a real table

The desktop app is also what runs on the table. On the table's computer it runs
in **present mode**: fullscreen on the table's display, no authoring chrome, with
pucks and fingers coming from the table's tracker over TUIO instead of from the
mouse. Interfaces run unchanged; to them a real puck and a simulated one are the
same thing.

This is for whoever sets a table up. Designers do not need any of it.

Anything below about specific hardware is *unconfirmed* until it has been tried
on that hardware. The [on-site checklist](#on-site-checklist) is how it gets
confirmed.

## What it needs

- The table's computer, running Windows (the `Planchette-<version>-setup.exe`
  from the GitHub release) or macOS.
- A tracker that sends **TUIO 1.1** over UDP: objects as `/tuio/2Dobj`, fingers
  as `/tuio/2Dcur`. MultiTaction's stack can: add a `TuioSender` block to
  `config.txt`, or point the on-screen display at a TUIO listener, then run
  `MTServer` (*unconfirmed*; check the MultiTaction documentation for the exact
  block). reacTIVision and the TUIO simulators also work.
- A workspace folder holding the interfaces, the same kind designers use. See
  [Getting interfaces onto the table](#getting-interfaces-onto-the-table).

## Preparing the table's computer

Do this once, before setting up Planchette itself. Most of it is about stopping
Windows from doing things a person at a desk wants and a table does not. The
menu paths are Windows 11's and move between versions, so they are *unconfirmed*
for any particular table until someone has done them there.

Some of these settings (signing in automatically, delaying updates) may not be
ours to change on a client's computer. Check with whoever owns the machine
before changing them.

### Install Planchette

Use the installer, `Planchette-<version>-setup.exe` from the GitHub release, not
the portable `.exe`: the installer puts the app in a fixed place, so the startup
shortcut below keeps working through upgrades. The build is unsigned, so the
first run shows *Windows protected your PC*; click **More info**, then
**Run anyway**. Once per machine.

Upgrading later is the same: run the new installer. `table.json` (puck
assignments, calibration) lives in Planchette's settings folder, not in the app,
so it survives.

### Make the table the main display

If the computer has more than one screen, open **Settings > System > Display**,
select the table, and tick **Make this my main display**. Present mode opens on
the main display, so this is all it needs; `display` in `table.json` exists for
when that is not possible, but its numbering is not guaranteed to match the
numbers Windows shows.

Set the table's resolution to its native one (3840 x 2160 for the 55 inch
panel). Windows display *scaling* does not matter: present mode overrides it.

### Stop touch from reaching Windows

The table's fingers reach interfaces through TUIO, but if the panel also reports
touch to Windows, a hand on the table edge can open Windows' own panels.

- **Edge swipes.** On Pro and Enterprise editions: run `gpedit.msc`, go to
  **Computer Configuration > Administrative Templates > Windows Components >
  Edge UI**, and set **Allow edge swipe** to **Disabled**.
- **Touch gestures.** **Settings > Bluetooth & devices > Touch**: turn off
  three- and four-finger touch gestures.
- **The touch keyboard.** **Settings > Time & language > Typing > Touch
  keyboard**: set it never to show.
- If the panel's touch can be switched off at the hardware or driver level
  entirely, leaving only the TUIO output, that is the cleanest of all.

### Keep it awake and quiet

- **Sleep and screen.** **Settings > System > Power** (or **Power & battery**):
  set the screen and sleep to **Never** when plugged in. From an administrator
  command prompt, the same thing:

      powercfg /change monitor-timeout-ac 0
      powercfg /change standby-timeout-ac 0

- **Notifications.** **Settings > System > Notifications**: turn them off, so
  nothing appears over the interface.
- **Updates.** **Settings > Windows Update > Advanced options > Active hours**:
  cover the hours the table is in use, so Windows does not restart in the
  middle of them. Better still, agree an update window with the machine's
  owner.

### Start Planchette when the computer starts

1. Press `Win+R`, type `shell:startup`, and press Enter. A folder opens.
2. Put a shortcut to Planchette in it (right-drag Planchette from the Start
   menu into the folder and choose **Create shortcut here**, or copy the one
   from the desktop).
3. Once the table is set up, set `"present": true` in `table.json` (step 6
   below), so it starts straight into present mode.

This only runs once someone signs in. For a table that should come back by
itself after a power cut, the account also has to sign in automatically, which
is a security decision for the machine's owner. Microsoft's Sysinternals
*Autologon* tool is the usual way, if they agree.

### Getting interfaces onto the table

Planchette on the table reads interfaces from a workspace folder, exactly as on
a designer's laptop.

- **Simplest:** copy the designers' workspace folder onto the table's computer,
  then in Planchette open **Settings** and **Add…** that folder. To update,
  copy again. Planchette notices changed files and reloads by itself.
- **A synced folder** (Google Drive, Dropbox, a git checkout) also works, and
  then designers' saves appear on the table. That is handy during a build and
  risky during an event: a half-synced change shows up live. Freeze it, or
  switch to a copy, before the table is in front of the public.

The interface picker on the table lists every folder in the workspace except
those starting with `_`, so remove experiments the public should not see.

## Setting a table up

1. **Point the tracker at Planchette.** By default Planchette listens on
   `127.0.0.1:3333`, the TUIO default, which suits a tracker on the same
   computer. If the tracker is on another machine, set `tuio.host` to
   `0.0.0.0` in `table.json` (below) and expect a firewall prompt the first time.
2. **Turn on table input.** **Settings** (`Ctrl+,`) > **Table input**. The status
   line should say *Listening* and show packets arriving.
3. **Assign the pucks.** **Table > Assign Pucks…** Put one puck down; it appears
   as *Tag 117* (or whatever is printed on it). Click **Make it puck 1**. Lift it,
   put the next one down, and so on. These numbers are what interfaces use, so
   match what the designers built against; give each a label so the next person
   knows which is which.
4. **Choose a control puck** (optional, recommended). In the same dialog, put a
   spare puck down and click **Make it the control puck**. On the table, putting
   it down opens the interface picker. It never reaches an interface.
5. **Calibrate.** **Table > Calibrate…** Each puck is drawn where Planchette
   thinks it is, with a line for its north. Slide a puck along each edge; if it
   is mirrored, use the flips. Turn it; if the line turns the wrong way, use
   **Reverse rotation**. Then point a puck's arrow at the top edge of the screen
   and click **The puck now points at the top edge**.
6. **Enter present mode.** **Table > Enter Present Mode** (`Ctrl+Shift+F`). The
   app restarts fullscreen. To make the table boot straight into it, set
   `"present": true` in `table.json` (**Table > Show table.json**, edit, save,
   restart Planchette), and add Planchette to the computer's startup items
   ([above](#start-planchette-when-the-computer-starts)).

Every change in steps 3 to 5 is saved and applied at once, including to pucks
already sitting on the table.

## In present mode

- **Changing interface:** put the control puck down. The interfaces appear in a
  ring around it; turning the puck highlights one, and touching any of them
  opens it. Lift the puck to close the ring (it waits a moment, because tracking
  flickers). With a keyboard: `Ctrl+Shift+P`, arrows, `Enter`, `Esc`.
- **Leaving:** **Table > Leave Present Mode**, or `Ctrl+Shift+F`. Launching with
  `--no-present` also overrides `table.json`, for when a table that boots into
  present mode needs the authoring UI.
- The surface is drawn at exactly one table pixel per screen pixel, whatever the
  operating system's display scaling. If the display does not match the surface
  preset, an orange banner says so; the sizes on screen are then not the sizes
  the interfaces were designed for.
- Native touch is ignored. Fingers reach interfaces through TUIO only, so they
  are never counted twice.

## `table.json`

Per computer, in Planchette's settings folder. **Table > Show table.json**
reveals it. The dialogs write it; editing by hand is fine, and a file with a
typo is copied to `table.json.broken` before anything overwrites it.

```json
{
  "version": 1,
  "present": false,
  "display": null,
  "surface": "table55-4k",
  "tuio": { "enabled": false, "host": "127.0.0.1", "port": 3333, "staleMs": 2000 },
  "calibration": { "flipX": false, "flipY": false, "angleOffsetDeg": 0, "angleReversed": false },
  "pucks": [{ "markerId": 1, "tag": 117, "label": "red" }],
  "control": { "tag": 900 },
  "unmapped": "ignore"
}
```

| Field | Meaning |
| ----- | ------- |
| `present` | Boot into present mode. |
| `display` | Which display present mode uses, as an index into the system's list. `null` is the primary display. |
| `surface` | A surface preset id (`src/host/surface.ts`). Must match the panel, or sizes are wrong. |
| `tuio.host`, `tuio.port` | Where to listen. `127.0.0.1` accepts only this computer; `0.0.0.0` accepts the network. |
| `tuio.staleMs` | If the tracker sends nothing for this long, everything is lifted off the table. `0` turns this off. |
| `calibration` | Applied to every position and angle before anything else sees it. |
| `pucks` | Printed tag to the `markerId` interfaces use. One tag per puck, one puck per tag. |
| `control.tag` | The control puck's tag, or `null`. |
| `unmapped` | A tag with no assignment: `ignore` it, or `passthrough` as its own number. Until anything is assigned, tags always pass through, so a new table does something. |

## Trying it without a table

`scripts/tuio-send.mjs` sends TUIO the way a tracker does:

    node scripts/tuio-send.mjs                  # two pucks (tags 117, 42) and a finger, moving
    node scripts/tuio-send.mjs place 117 0.3 0.6 45
    node scripts/tuio-send.mjs flicker 117      # lost and found every second

Turn on table input in Settings first. Present mode can be tried on a laptop
too (it will show the not-1:1 banner).

## Measuring lag

If what the table shows trails the hand, **Table > Latency Check**
(`Ctrl+Shift+L`) says where the time goes. It draws over whatever interface is
running, in present mode too, and the same command closes it. Counts start when
it opens, so close and reopen it between tests.

Lag is four delays added together, and each has its own fix:

    tracker  ->  Planchette  ->  the interface  ->  the display

**The ruler** is the whole delay, end to end. Every puck and finger gets a
yellow ring exactly where the tracker last reported it. While it moves, a ruler
runs ahead of the ring along the direction of travel, ticked at 50, 100, 150 and
200 ms at the current speed. Slide a puck steadily and look at where the
physical puck's centre sits on the ruler: at the 100 tick, everything between
the puck and the screen adds up to about 100 ms. With no lag at all, the puck
would sit in its ring. Software cannot measure this on its own because it cannot
see the puck; an eye, or a slow-motion phone video paused mid-slide, can.

**The readout** splits it up:

| Line | What it is | Healthy |
| ---- | ---------- | ------- |
| Frame rate | How often the screen is redrawn. An interface shares this, so a heavy one pulls it down. *Long* counts frames over 25 ms, each one a visible stutter. | The display's refresh rate, usually 60, with long frames rare |
| Tracker | Packets per second from the tracker | Steady while things move (the rate for any given tracker is *unconfirmed*) |
| Planchette | From a packet arriving to it reaching the interface, median and worst | A few ms. More means the computer is busy, usually with the interface |
| While moving | How often a moving puck or finger gets a new position, and the longest wait | Close to the tracker's rate; gaps under 50 ms |
| Lost and found | A puck that vanished and came back within a second, and the longest absence | 0, or very rare |

### The test

About 20 minutes, in present mode, with table input on. Bring one puck and a
phone that films slow motion. Write the numbers down as you go (there is a
table below).

1. **Idle.** Nothing on the table. Note the frame rate and long frames.
2. **Tracker rate.** Slide a puck in slow circles for ten seconds. Note
   packets/s and updates/s while moving.
3. **End to end.** Slide the puck in a straight line at a steady, medium
   speed, about a metre in two seconds. Note the tick the real puck sits at.
   Do it five times, both directions. If it is too quick to read, film it in
   slow motion and pause mid-slide. Then do the same with one finger.
4. **Fast.** Slide the puck back and forth hard, ten times. Note *Lost and
   found* and the longest gap.
5. **The display.** Find the display's picture settings (its remote or on-screen
   menu) and look for a *Game*, *PC* or low-latency mode. Note what it was on,
   switch, and repeat step 3.
6. **The tracker.** Open the tracker's own software and look for smoothing,
   filtering or prediction settings. Note what they are, turn smoothing to its
   lowest, and repeat steps 3 and 4. Change one setting at a time, and put back
   anything that does not help.
7. **The interface.** Open the interface people noticed lag in, with the check
   still open, and use it for a minute. Note the frame rate and long frames.
   Watch whether the interface's own graphics trail the yellow ring.

| Test | Result |
| ---- | ------ |
| Idle: frame rate, long frames | |
| Tracker: packets/s, updates/s while moving | |
| End to end, puck: tick (five tries) | |
| End to end, finger: tick | |
| Fast: lost and found, longest gap | |
| Display mode before, after; tick after | |
| Tracker settings changed; tick and lost and found after | |
| The interface: frame rate, long frames, trails the ring? | |

### Reading the results

| Seen | Where the time goes | What helps |
| ---- | ------------------- | ---------- |
| The ruler says 100 ms or more, Planchette says a few ms, frame rate is steady | The tracker or the display | Steps 5 and 6. A display's image processing alone can add 50 ms or more |
| Frame rate drops, or long frames climb, only with one interface open | That interface is too heavy for this computer | Make the interface draw less: smaller or fewer canvases, no large blurs or shadows redrawn every frame |
| The interface's graphics trail the yellow ring | The interface itself: easing, smoothing, or a slow loop | Fix it in the interface. Its graphics should be where the ring is |
| Updates/s while moving well below packets/s, long gaps, lost and found climbing with speed | The tracker loses the puck's tag in motion | Tracker settings, lighting on the table, clean and flat tags, a slower game |
| Planchette above about 5 ms | The computer is busy | Usually the interface; check the frame rate with it open |

## Troubleshooting

| Symptom | Likely cause |
| ------- | ------------ |
| Status says *port 3333 is already in use* | Another TUIO listener is running, often the vendor's own demo app. Close it, or move one of them to another port. |
| Listening, but 0 packets | The tracker is sending somewhere else (check its host and port), or it is on another machine and `tuio.host` is still `127.0.0.1`. |
| Pucks show in the inspector as *unmapped* and nothing happens | They have no assignment. **Table > Assign Pucks…** |
| Every puck vanishes every couple of seconds while sitting still | The tracker sends nothing while nothing moves (*unconfirmed* for any given tracker). Set `tuio.staleMs` to `0`. |
| After starting Planchette, pucks already on the table do not appear until moved | The tracker only sends positions for things that move. Nudge them. |
| Everything is mirrored, or turns the wrong way | **Table > Calibrate…** |
| What the table shows trails the hand | [Measuring lag](#measuring-lag) |
| Orange *Not 1:1* banner | `surface` does not match the display, or present mode is on the wrong display (`display`). |

## On-site checklist

The first time on a new kind of table, go through these and record what was
found in this document, replacing the *unconfirmed* notes above.

1. The computer is prepared: a hand dragged in from each edge opens nothing
   of Windows', no touch keyboard appears, and the screen stays on past its
   usual timeout. Note the Windows edition and version, and correct the menu
   paths above if they differ.
2. Settings shows packets arriving with nothing on the table. If not, note
   whether this tracker only sends on change, and set `staleMs` to `0` if so.
3. Assign every puck and the control puck. Note the tag numbers on the pucks.
4. Calibrate: each edge, each corner, rotation direction, north.
5. Each example interface responds to pucks and fingers as it does in the
   simulator, with four people touching at once.
6. Put a hand flat over a puck and lift it: the interface should treat it as a
   brief absence, not a removal.
7. Unplug the tracker's connection (or stop `MTServer`): the table clears within
   `staleMs`, and recovers when it comes back.
8. Reboot: the computer comes back into present mode, on the right display, with
   the last interface.
9. Run [the lag test](#the-test) and keep its table of results.
