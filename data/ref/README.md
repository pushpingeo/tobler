# Reference layers

Natural Earth (public domain, naturalearthdata.com), simplified for the browser by `scripts/build-reference.mjs`.

| File | Source | Kept |
|---|---|---|
| countries.json | 1:10m admin 0 countries | name, ISO code, sovereign state |
| coastline.json | 1:10m coastline | geometry |
| places.json | 1:10m populated places | name, country, region, population, rank |
| rivers.json | 1:50m rivers | name, rank |
| lakes.json | 1:50m lakes | name, rank |

These are made for regional and global views. Borders follow Natural Earth's de facto conventions, and the
coastline is accurate to roughly a kilometre, so site-scale work uses OpenStreetMap instead.

## UK nations and councils

`uk-areas.json`: the four nations and the councils that `catalogue/checks.json` names (`in`), from the Office for
National Statistics' Open Geography Portal: Countries (December 2025) and Local Authority Districts (May 2025),
generalised (BGC) outlines clipped to the coastline, simplified to within 100 m, islands under 0.5 km² left out.
Open Government Licence v3.0. Source: Office for National Statistics licensed under the Open Government Licence
v.3.0. Contains OS data © Crown copyright and database right 2025. Built by `scripts/build-uk-areas.mjs`; re-run it
when a check names a new council. The checks use it to decide which nation's or council's layers a site's reach
touches (`js/ukareas.js`).

