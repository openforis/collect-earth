import { describe, expect, it } from 'vitest';
import { hasPolygonColumn, plotOutline, visibleId } from '../src/plotShape.js';

const props = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe('plotOutline: the plot shape Collect Earth draws, from project_definition.properties', () => {
  it('SQUARE (SquareKmlGenerator.fillExternalLine): side = distance × ((int) √points + 1 − 2) + 2 × boundary distance', () => {
    // 25 points 20 m apart, 10 m to the border: rows 6, side 20 × 4 + 20 = 100 m.
    expect(plotOutline(props({ sample_shape: 'SQUARE', number_of_sampling_points_in_plot: '25', distance_between_sample_points: '20', distance_to_plot_boundaries: '10' }))).toEqual({ kind: 'square', sideMeters: 100 });
    // 49 points 10 m apart, 5 m: rows 8, 10 × 6 + 10 = 70 m. 1 point: 0 × 10 + 2 × 35 = 70 m.
    expect(plotOutline(props({ sample_shape: 'SQUARE', number_of_sampling_points_in_plot: '49', distance_between_sample_points: '10', distance_to_plot_boundaries: '5' }))).toEqual({ kind: 'square', sideMeters: 70 });
    expect(plotOutline(props({ sample_shape: 'SQUARE', number_of_sampling_points_in_plot: '1', distance_between_sample_points: '10', distance_to_plot_boundaries: '35' }))).toEqual({ kind: 'square', sideMeters: 70 });
    // 30 points: (int) √30 = 5, as Java's cast: 20 × 4 + 20.
    expect(plotOutline(props({ sample_shape: 'SQUARE', number_of_sampling_points_in_plot: '30', distance_between_sample_points: '20', distance_to_plot_boundaries: '10' }))).toEqual({ kind: 'square', sideMeters: 100 });
    // No shape set: Collect Earth's default square, and its 25 points when none are set; SQUARE_CIRCLE keeps the square's outline.
    expect(plotOutline(props({ distance_between_sample_points: '20', distance_to_plot_boundaries: '10' }))).toEqual({ kind: 'square', sideMeters: 100 });
    expect(plotOutline(props({ sample_shape: 'square_circle', number_of_sampling_points_in_plot: '25', distance_between_sample_points: '20', distance_to_plot_boundaries: '10' }))).toEqual({ kind: 'square', sideMeters: 100 });
  });

  it('CIRCLE (CircleKmlGenerator): radius = distance + 5 m, 130 vertices; HEXAGON 6', () => {
    expect(plotOutline(props({ sample_shape: 'CIRCLE', distance_between_sample_points: '30' }))).toEqual({ kind: 'circle', radiusMeters: 35, vertices: 130 });
    expect(plotOutline(props({ sample_shape: 'HEXAGON', distance_between_sample_points: '50' }))).toEqual({ kind: 'circle', radiusMeters: 55, vertices: 6 });
  });

  it('shapes it cannot draw from the centre, or missing numbers: only the place', () => {
    for (const shape of ['NFMA', 'NFMA_250', 'NFI_THREE_CIRCLES', 'NFI_FOUR_CIRCLES', 'KML_POLYGON', 'WKT_POLYGON', 'GEOJSON_POLYGON']) {
      expect(plotOutline(props({ sample_shape: shape, distance_between_sample_points: '20', distance_to_plot_boundaries: '10' })), shape).toEqual({ kind: 'place' });
    }
    expect(plotOutline(props({ sample_shape: 'SQUARE', distance_between_sample_points: 'x', distance_to_plot_boundaries: '10' }))).toEqual({ kind: 'place' });
    expect(plotOutline(props({ sample_shape: 'CIRCLE' }))).toEqual({ kind: 'place' });
    expect(plotOutline(null)).toEqual({ kind: 'place' });
    // A plot file with a polygon column: Collect Earth draws those polygons.
    expect(plotOutline(props({ sample_shape: 'SQUARE', distance_between_sample_points: '20', distance_to_plot_boundaries: '10' }), true)).toEqual({ kind: 'place' });
  });

  it('hasPolygonColumn: a KML, WKT or GeoJSON polygon in a row', () => {
    expect(hasPolygonColumn(['1', '-1.2', '36.8', 'POLYGON((36 -1, 36.1 -1, 36.1 -1.1, 36 -1))'])).toBe(true);
    expect(hasPolygonColumn(['1', '-1.2', '36.8', '<Polygon><outerBoundaryIs>…'])).toBe(true);
    expect(hasPolygonColumn(['1', '-1.2', '36.8', '{"type":"Polygon","coordinates":[]}'])).toBe(true);
    expect(hasPolygonColumn(['1', '-1.2', '36.8', 'Forest', 'polygon 3'])).toBe(false);
  });
});

describe('visibleId: the plot id as the collector sees it (KmlGenerator.getVisiblePlacemarkId)', () => {
  it('leaves out the keys hidden from the record list', () => {
    expect(visibleId('101,2', [false, true])).toBe('101');
    expect(visibleId('A,101,2', [false, false, true])).toBe('A,101');
    // A plot unit without its hidden round part is already what the collector sees.
    expect(visibleId('101', [false, true])).toBe('101');
    expect(visibleId('101', [false])).toBe('101');
    expect(visibleId('101,7', [false, false])).toBe('101,7');
    expect(visibleId('101', null)).toBe('101');
  });
});
