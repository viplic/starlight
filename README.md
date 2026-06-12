# STAR LIGHT NAKIT - Kasa

Responzivna aplikacija za vođenje dnevne evidencije i stanja kase u BAM/KM.
Podaci se čuvaju u Neon Postgres bazi preko Vercel serverless API-ja.

## Podešavanje

1. U Vercel projektu dodajte `DATABASE_URL` environment varijablu sa Neon
   connection stringom.
2. Instalirajte pakete:

```bash
npm install
```

3. Za lokalni razvoj napravite `.env.local`:

```text
DATABASE_URL=postgresql://...
```

4. Pokrenite projekat kroz Vercel CLI:

```bash
npx vercel dev
```

Tabele `starlight_settings` i `starlight_entries` kreiraju se automatski pri
prvom API zahtjevu. CSV izvoz radi iz sekcije Izvještaji, a opcija
Štampaj / PDF koristi dijalog preglednika.
