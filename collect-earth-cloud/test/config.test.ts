import { describe, expect, it } from 'vitest';
import { loadConfig, OSM_TILES } from '../src/config.js';

describe('MIGRATION_DATABASE_URL', () => {
  it('is the owner connection for the migrations, unset when blank', () => {
    const env = { STORE_BACKEND: 'postgres', DATABASE_URL: 'postgres://ce_app:a@/db' };
    expect(loadConfig({ ...env, MIGRATION_DATABASE_URL: ' postgres://ce:b@/db ' }).migrationDatabaseUrl).toBe('postgres://ce:b@/db');
    expect(loadConfig({ ...env, MIGRATION_DATABASE_URL: ' ' }).migrationDatabaseUrl).toBeUndefined();
    expect(loadConfig(env).migrationDatabaseUrl).toBeUndefined();
  });
});

describe('MAP_TILE_URL and the map tiles', () => {
  it('uses OpenStreetMap when unset', () => {
    expect(loadConfig({}).mapTiles).toEqual(OSM_TILES);
    expect(OSM_TILES).toEqual({
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap contributors',
      attributionUrl: 'https://www.openstreetmap.org/copyright',
      maxZoom: 19,
    });
  });

  it('takes another tile source with its attribution', () => {
    expect(
      loadConfig({
        MAP_TILE_URL: ' https://tiles.example.org/{z}/{x}/{y}.png?key=abc ',
        MAP_TILE_ATTRIBUTION: '© Example, © OpenStreetMap contributors',
        MAP_TILE_ATTRIBUTION_URL: 'https://example.org/attribution',
        MAP_TILE_MAX_ZOOM: '18',
      }).mapTiles,
    ).toEqual({
      url: 'https://tiles.example.org/{z}/{x}/{y}.png?key=abc',
      attribution: '© Example, © OpenStreetMap contributors',
      attributionUrl: 'https://example.org/attribution',
      maxZoom: 18,
    });
    // http only for a tile server on this machine.
    expect(loadConfig({ MAP_TILE_URL: 'http://localhost:8081/{z}/{x}/{y}.png', MAP_TILE_ATTRIBUTION: 'Mine' }).mapTiles).toMatchObject({ attributionUrl: null, maxZoom: 19 });
  });

  it('refuses a tile URL without {z}, {x}, {y}, not https, without an attribution, or a bad zoom', () => {
    const attribution = { MAP_TILE_ATTRIBUTION: 'A' };
    expect(() => loadConfig({ MAP_TILE_URL: 'https://t.example.org/{z}/{x}.png', ...attribution })).toThrow(/MAP_TILE_URL/);
    expect(() => loadConfig({ MAP_TILE_URL: 'http://t.example.org/{z}/{x}/{y}.png', ...attribution })).toThrow(/MAP_TILE_URL/);
    expect(() => loadConfig({ MAP_TILE_URL: 'javascript:alert(1)//{z}/{x}/{y}', ...attribution })).toThrow(/MAP_TILE_URL/);
    expect(() => loadConfig({ MAP_TILE_URL: 'https://t.example.org/{z}/{x}/{y}.png' })).toThrow(/MAP_TILE_ATTRIBUTION/);
    expect(() => loadConfig({ MAP_TILE_URL: 'https://t.example.org/{z}/{x}/{y}.png', ...attribution, MAP_TILE_ATTRIBUTION_URL: 'ftp://x' })).toThrow(/MAP_TILE_ATTRIBUTION_URL/);
    expect(() => loadConfig({ MAP_TILE_URL: 'https://t.example.org/{z}/{x}/{y}.png', ...attribution, MAP_TILE_MAX_ZOOM: '30' })).toThrow(/MAP_TILE_MAX_ZOOM/);
    // Only Leaflet's placeholders: {z}, {x}, {y}, {-y}, {s}, {r}.
    expect(() => loadConfig({ MAP_TILE_URL: 'https://t.example.org/{z}/{x}/{y}.png?key={apikey}', ...attribution })).toThrow(/MAP_TILE_URL/);
    expect(loadConfig({ MAP_TILE_URL: 'https://{s}.t.example.org/{z}/{x}/{-y}{r}.png?y={y}', ...attribution }).mapTiles?.url).toBe('https://{s}.t.example.org/{z}/{x}/{-y}{r}.png?y={y}');
    // An attribution alone changes nothing that is not set.
    expect(() => loadConfig({ MAP_TILE_ATTRIBUTION: 'A' })).toThrow(/MAP_TILE_URL/);
  });
});
