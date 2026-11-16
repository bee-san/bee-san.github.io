# bee-san.github.io

[![Discord](https://img.shields.io/discord/754001738184392704?logo=discord&label=Discord)](https://discord.skerritt.blog)

A home page that lists every one of my GitHub Pages sites as a grid of tiles, A to Z, so I can find them.

Live at <https://bee-san.github.io/>.

## How it works

- `index.html` is the whole site: inline CSS and JS, no build step.
- The tiles in the HTML are a saved list, with each site's real URL (including custom domains like `cyberfork.skerritt.blog`).
- On load, the page asks the GitHub API for my public repos and adds a tile for any repo that has Pages enabled, isn't archived, and isn't already listed. Those new tiles use `https://bee-san.github.io/<repo>/`, since the public API doesn't expose custom domains without auth.
- If GitHub can't be reached or the rate limit (60 requests an hour per IP, unauthenticated) is hit, the saved list still shows.

To refresh the saved list, copy an existing `<li class="tile">` block in `index.html` and change the repo name, URL, description and `--h` tint.
- A search box filters the tiles by name, description and address as you type (press `/` to jump to it, `Esc` to clear, `Enter` to open the first match).
- A Light/Dark button overrides the system theme. The choice is saved under the `bee-theme` key in `localStorage`, and the pages in this repo share it.

## Pages in this repo

- [`crochet/`](crochet/): **Crochet Round Tracker**. Paste an amigurumi pattern and work through it stitch by stitch. See [crochet/README.md](crochet/README.md).
- [`transcribe/`](transcribe/): **Video Transcriber**. Drop a video or audio file in to get a transcript (.txt, .srt or .vtt). It runs Whisper in your browser with [transformers.js](https://github.com/huggingface/transformers.js), so the file never leaves your device. YouTube links can't be fetched by a static page, so download the audio first, e.g. `yt-dlp -x --audio-format mp3 "<url>"`.
