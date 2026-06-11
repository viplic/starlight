# STAR LIGHT NAKIT - Kasa

Responzivna aplikacija za vođenje dnevne evidencije i stanja kase u BAM/KM.

## Pokretanje

Iz ovog foldera pokrenite:

```bash
python3 -m http.server 8080
```

Zatim otvorite `http://localhost:8080`.

Podaci se automatski čuvaju u `localStorage` preglednika. CSV izvoz radi iz
sekcije Izvještaji, a opcija Štampaj / PDF koristi dijalog preglednika.
