import { describe, expect, it } from 'vitest';
import { mergePlotFiles, myPlotsVersion, type PlotFilePart } from '../src/myPlots.js';

const part = (csvFileId: string, filename: string, text: string): PlotFilePart => ({ csvFileId, filename, data: Buffer.from(text, 'utf8') });
const lines = (data: Buffer) => data.toString('utf8').trimEnd().split('\n');

describe('the person’s plots in one plot file', () => {
  it('puts every part’s rows under one header, each plot once, the first part’s row kept', () => {
    const merged = mergePlotFiles(
      [
        part('a', 'north.csv', 'id,YCoordinate,XCoordinate,province\n1,1,1,La Paz\n2,2,2,Oruro\n'),
        part('b', 'south.csv', 'id,YCoordinate,XCoordinate,province\n3,3,3,Potosi\n2,9,9,elsewhere\n'),
      ],
      1,
    );
    expect(lines(merged.data)).toEqual(['id,YCoordinate,XCoordinate,province', '1,1,1,La Paz', '2,2,2,Oruro', '3,3,3,Potosi']);
    expect(merged.plots).toBe(3);
    expect(merged.repeated).toBe(1);
    expect(merged.sources).toEqual([
      { csvFileId: 'a', filename: 'north.csv', plots: 2 },
      { csvFileId: 'b', filename: 'south.csv', plots: 1 },
    ]);
    expect(merged.leftOut).toEqual([]);
    expect(merged.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('puts a part’s columns in the order of the others, by name in any letter case', () => {
    const merged = mergePlotFiles(
      [
        part('a', 'a.csv', 'id,YCoordinate,XCoordinate,province,slope\n1,1,1,La Paz,4\n2,2,2,Oruro,5\n'),
        part('b', 'b.csv', 'ID;province;xcoordinate;ycoordinate;SLOPE\n3;Potosi;30;-3;6\n'),
      ],
      1,
    );
    expect(lines(merged.data)).toEqual(['id,YCoordinate,XCoordinate,province,slope', '1,1,1,La Paz,4', '2,2,2,Oruro,5', '3,-3,30,Potosi,6']);
  });

  it('leaves out a part with other columns, and says so; a file without a header row is taken when it is no wider', () => {
    const merged = mergePlotFiles(
      [
        part('a', 'a.csv', 'id,YCoordinate,XCoordinate,province\n1,1,1,La Paz\n2,2,2,Oruro\n'),
        part('b', 'b.csv', 'id,YCoordinate,XCoordinate,district\n3,3,3,Uyuni\n'),
        part('c', 'c.csv', '4,4,4,Tarija\n'),
        part('d', 'd.csv', '5,5,5,Beni,extra\n'),
      ],
      1,
    );
    expect(lines(merged.data)).toEqual(['id,YCoordinate,XCoordinate,province', '1,1,1,La Paz', '2,2,2,Oruro', '4,4,4,Tarija']);
    expect(merged.leftOut).toEqual([
      { csvFileId: 'b', filename: 'b.csv', reason: 'columns_differ' },
      { csvFileId: 'd', filename: 'd.csv', reason: 'columns_differ' },
    ]);
  });

  it('keeps a plot’s rows together, quotes values that need it, and writes the plot file of each row when asked', () => {
    const merged = mergePlotFiles(
      [
        part('a', 'polygons, north.csv', 'id;YCoordinate;XCoordinate;wkt\n1;1;1;"POLYGON((0 0, 1 1))"\n1;1;1;second\n'),
        part('b', 'b.csv', 'id;YCoordinate;XCoordinate;wkt\n2;2;2\n'),
      ],
      1,
      { plotFile: true },
    );
    expect(lines(merged.data)).toEqual([
      'id,YCoordinate,XCoordinate,wkt,plot_file',
      '1,1,1,"POLYGON((0 0, 1 1))","polygons, north.csv"',
      '1,1,1,second,"polygons, north.csv"',
      '2,2,2,,b.csv',
    ]);
    expect(merged.plots).toBe(2);
  });

  it('counts a plot and its re-assessment apart (the round is a key)', () => {
    const merged = mergePlotFiles(
      [part('r', 'To check again – a.csv', 'id,round,YCoordinate,XCoordinate\n1,2,1,1\n'), part('a', 'a.csv', 'id,round,YCoordinate,XCoordinate\n1,1,1,1\n2,1,2,2\n')],
      2,
    );
    expect(lines(merged.data)).toEqual(['id,round,YCoordinate,XCoordinate', '1,2,1,1', '1,1,1,1', '2,1,2,2']);
    expect(merged.plots).toBe(3);
  });

  it('leaves out the rows Collect Earth cannot read, and counts them', () => {
    const readable = (fields: readonly string[]) => [1, 2].every((i) => /^-?\d+(\.\d+)?$/.test(fields[i] ?? ''));
    const merged = mergePlotFiles([part('a', 'a.csv', 'id,lat,lon\n1,1,1\n2,north,1\n3,3\n')], 1, { readable });
    expect(lines(merged.data)).toEqual(['id,lat,lon', '1,1,1']);
    expect(merged).toMatchObject({ plots: 1, unreadable: 2 });
  });

  it('is empty when the person holds nothing', () => {
    const merged = mergePlotFiles([], 1);
    expect(merged.data.length).toBe(0);
    expect(merged.plots).toBe(0);
  });

  it('has a version that changes with what the person gets, and only then', () => {
    const one = myPlotsVersion([{ csvFileId: 'a', checksum: 'x' }]);
    expect(myPlotsVersion([{ csvFileId: 'a', checksum: 'x' }])).toBe(one);
    expect(myPlotsVersion([{ csvFileId: 'a', checksum: 'y' }])).not.toBe(one);
    expect(myPlotsVersion([{ csvFileId: 'a', checksum: 'x' }, { csvFileId: 'b', checksum: 'z' }])).not.toBe(one);
  });
});
