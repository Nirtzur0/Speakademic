<div align="center">
  <img
    src="extension/icons/icon128.png"
    alt="Speakademic icon"
    width="88"
  />

  <h1>Speakademic</h1>

  <p>
    <strong>Read academic papers like they were made for listening.</strong>
  </p>

  <p>
    Speakademic is a local-first Chrome extension for people who live in PDFs
    and long-form articles. Open a paper or article, press play, and hear it
    in a clean, natural AI voice with a floating reader that remembers your
    place.
  </p>

  <p>
    No accounts. No cloud upload. No sending your papers anywhere.
  </p>
</div>

<p align="center">
  <img
    src="docs/assets/readme-hero.svg"
    alt="Speakademic hero product shot"
    width="100%"
  />
</p>

<table>
  <tr>
    <td width="25%" align="center">
      <strong>Local by default</strong><br />
      Your reading stays on your machine, and audio is generated locally.
    </td>
    <td width="25%" align="center">
      <strong>PDFs and articles</strong><br />
      It reads academic PDFs and readable web articles with the same player.
    </td>
    <td width="25%" align="center">
      <strong>Cleans the noise</strong><br />
      It strips citation clutter, reference sections, long links, and
      equation-heavy spans.
    </td>
    <td width="25%" align="center">
      <strong>Voices you can choose</strong><br />
      Pick from multiple Kokoro voice profiles for long listening sessions.
    </td>
  </tr>
</table>

> Speakademic is for the part of research that happens away from the desk:
> revisiting a methods section on a walk, listening through a dense paper on a
> late train, or getting one more pass through a draft without staring at the
> screen.

## Why People Like It

- It feels like a reading tool, not a control panel.
- It reads both academic PDFs and readable web articles.
- It cleans author-year citation clutter, trailing references, long links, and
  equation-heavy passages so listening stays smooth.
- It gives you multiple Kokoro voice profiles instead of one fixed voice.
- It lets you change voice, speed, and section without losing the thread.
- It remembers where you stopped, so you can come back later.
- It stays private, because the whole thing runs locally.

## Product Shots

<table>
  <tr>
    <td width="50%" valign="top">
      <img
        src="docs/assets/readme-overlay-shot.svg"
        alt="Speakademic floating player with follow-scroll transcript and text cleanup"
        width="100%"
      />
      <br />
      <strong>A player that keeps the text clean and in view.</strong><br />
      Follow-scroll playback, cleanup of academic clutter, and section-aware
      progress keep listening smooth without turning the page into a dashboard.
    </td>
    <td width="50%" valign="top">
      <img
        src="docs/assets/readme-settings-shot.svg"
        alt="Speakademic outline panel with section hierarchy"
        width="100%"
      />
      <br />
      <strong>An outline you can open only when you need it.</strong><br />
      Jump through long papers and readable articles in a clean hierarchy, then
      collapse the panel and go back to listening.
    </td>
  </tr>
</table>

## What It Does

- Reads academic PDFs and readable web articles aloud with a local Kokoro
  voice server.
- Shows a floating player directly on the page.
- Cleans author-year citation blocks, repeated headers and footers, long
  links, and trailing reference sections, and softens equation-heavy spans for
  smoother listening.
- Supports multiple Kokoro voice profiles and comfortable playback speeds.
- Detects sections so you can jump around more naturally.
- Saves your position, so long papers and articles feel less punishing.

## Run It

You only need a few things:

- a Mac
- Google Chrome
- Docker Desktop, if you want the easiest setup

### 1. Start the local voice server

From this repo:

```bash
cd server
./start-server.sh
```

The first run downloads the voice model, so give it a minute.

### 2. Load the extension into Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Choose the `extension/` folder
5. If you read local PDFs, enable **Allow access to file URLs**

### 3. Open a paper and press play

Open any PDF in Chrome, click the Speakademic icon, and the floating player
appears on the page.

That is the whole flow.

## A Few Honest Notes

- Speakademic works best with text-based PDFs. Scanned PDFs may still need OCR.
- The first launch is slower than the rest because the local model has to warm
  up.
- If you want the full step-by-step version, use
  [Setup](docs/SETUP.md) and
  [Troubleshooting](docs/TROUBLESHOOTING.md).

## For Developers

If you want the repo layout at a glance:

- [`extension/`](extension/) holds the Chrome extension
- [`server/`](server/) starts the local Kokoro server
- [`docs/`](docs/) has the fuller setup and troubleshooting guides
