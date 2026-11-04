# bee-san.github.io

A home page that lists every one of my GitHub Pages sites as a grid of tiles, A to Z, so I can find them.

Live at <https://bee-san.github.io/>.

## How it works

- `index.html` is the whole site: inline CSS and JS, no build step.
- The tiles in the HTML are a saved list, with each site's real URL (including custom domains like `cyberfork.skerritt.blog`).
- On load, the page asks the GitHub API for my public repos and adds a tile for any repo that has Pages enabled, isn't archived, and isn't already listed. Those new tiles use `https://bee-san.github.io/<repo>/`, since the public API doesn't expose custom domains without auth.
- If GitHub can't be reached or the rate limit (60 requests an hour per IP, unauthenticated) is hit, the saved list still shows.

To refresh the saved list, copy an existing `<li class="tile">` block in `index.html` and change the repo name, URL, description and `--h` tint.
