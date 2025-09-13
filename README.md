Where For Weekend
=================

Static web app to find nearby spots (gourmet/sightseeing) by distance or travel time, show them on a map, and open routes in Google Maps. Built to run for free using browser Geolocation + Overpass (OpenStreetMap) + OSRM demo server.

Quick Start (Local)
- Serve `web/` over HTTP:
  - Python: `cd web && python -m http.server 8080` → open `http://localhost:8080`
  - Node: `npx http-server web -p 8080`

Features
- Distance or time filter; walking/driving
- Overpass POIs (gourmet, sightseeing + detailed categories)
- Leaflet map + marker clustering + list sync
- Google Maps directions on click (no API key)
- OSRM travel times with fallback to heuristic
- Favorites (localStorage), pagination
- URL sharing of state; viewport-based search
- PWA (offline for static assets)

Deploy to GitHub Pages (Recommended)
1) Create a new GitHub repository and push this project:
   - `git init`
   - `git add .`
   - `git commit -m "wfw: initial"`
   - `git branch -M main`
   - `git remote add origin https://github.com/<your-username>/<your-repo>.git`
   - `git push -u origin main`

2) Enable GitHub Pages via Actions:
   - Open GitHub → Repo → Settings → Pages
   - Build and deployment → Source: “GitHub Actions”
   - The workflow `.github/workflows/deploy.yml` will publish the `web/` folder

3) Wait for the `Deploy to GitHub Pages` workflow to finish
   - It will print the page URL like `https://<user>.github.io/<repo>/`

Notes
- Public Overpass/OSRM services may be rate limited; try again if slow
- Service worker caches static assets only; online data is fetched live
- All asset paths are relative, so project pages under subpath work fine

