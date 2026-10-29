import { describe, expect, it } from 'vitest';
import { buildPlotFile, parsePlotFile, plotOfRecordKey } from '../src/plots.js';

const parse = (text: string | Buffer) => parsePlotFile(Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8'));
const build = (text: string | Buffer, keys: string[]) =>
  buildPlotFile(parse(text), new Set(keys)).toString('utf8');

describe('plot file parser', () => {
  it('detects the separator: the first of , ; tab | giving at least 3 columns', () => {
    expect(parse('id,lat,lon\n1,0,0\n').separator).toBe(',');
    expect(parse('id;lat;lon\n1;0,5;0,5\n').separator).toBe(';');
    expect(parse('id\tlat\tlon\n1\t0\t0\n').separator).toBe('\t');
    expect(parse('id|lat|lon\n1|0|0\n').separator).toBe('|');
    // A ; file whose first line has two commas is still not comma separated: 2 columns.
    expect(parse('id;x,y;lon\n1;0;0\n').separator).toBe(';');
  });

  it('reads quoted fields holding the separator, quotes and line breaks', () => {
    const text = 'id,lat,lon,wkt\n1,0,0,"POLYGON((0 0, 1 1,\n 2 2))"\n2,1,1,"say ""hi"""\n';
    const file = parse(text);
    expect(file.rows).toHaveLength(2);
    expect(file.rows[0].fields[3]).toBe('POLYGON((0 0, 1 1,\n 2 2))');
    expect(file.rows[1].fields[3]).toBe('say "hi"');
    expect(file.plotIds).toEqual(['1', '2']);
  });

  it('treats the first line as a header only when none of its fields is a number', () => {
    expect(parse('id,lat,lon\n1,0,0\n').header?.fields).toEqual(['id', 'lat', 'lon']);
    expect(parse('1,0,0\n2,1,1\n').header).toBeNull();
    expect(parse('1,0,0\n2,1,1\n').plotIds).toEqual(['1', '2']);
    expect(parse('plot,-12.5,1e3\n').header).toBeNull();
  });

  it('keeps a BOM, CRLF line breaks and skips empty lines', () => {
    const text = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('id,lat,lon\r\n\r\n1,0,0\r\n  \r\n2,1,1\r\n,,\r\n3,2,2')]);
    const file = parse(text);
    expect(file.bom).toBe(true);
    expect(file.lineEnding).toBe('\r\n');
    expect(file.header?.fields[0]).toBe('id');
    expect(file.plotIds).toEqual(['1', '2', '3']);
    const own = buildPlotFile(file, new Set(['1', '3']));
    expect(own.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(own.subarray(3).toString('utf8')).toBe('id,lat,lon\r\n1,0,0\r\n3,2,2');
    // The last row of the original has no line break: one is added when rows follow it.
    expect(buildPlotFile(parse('1,0,0\n2,1,1'), new Set(['2', '1'])).toString('utf8')).toBe('1,0,0\n2,1,1');
  });

  it('builds a file of only the given plots, rows byte for byte, rows sharing an id together', () => {
    const text = 'id;lat;lon;wkt\n1;0;0;"A;B\nC"\n2;1;1;x\n1;5;5;second row of 1\n3;2;2;"é"\n';
    expect(build(text, ['1'])).toBe('id;lat;lon;wkt\n1;0;0;"A;B\nC"\n1;5;5;second row of 1\n');
    expect(build(text, ['3'])).toBe('id;lat;lon;wkt\n3;2;2;"é"\n');
    expect(build(text, [])).toBe('id;lat;lon;wkt\n');
    expect(parse(text).plotIds).toEqual(['1', '2', '3']);
  });

  it('keeps bytes that are not UTF-8 (a Latin-1 file) exactly', () => {
    const latin1 = Buffer.from('id,lat,lon,name\n1,0,0,Pe\xf1a\n2,1,1,x\n', 'latin1');
    const own = buildPlotFile(parse(latin1), new Set(['1']));
    expect(own).toEqual(Buffer.from('id,lat,lon,name\n1,0,0,Pe\xf1a\n', 'latin1'));
  });

  it('counts the widest row as the columns', () => {
    expect(parse('id,lat,lon\n1,0,0,extra,more\n').columnCount).toBe(5);
  });
});

describe('plotOfRecordKey', () => {
  const ids = new Set(['17', '17a', '2']);
  it('matches the id, or the id followed by more key values', () => {
    expect(plotOfRecordKey('17', ids)).toBe('17');
    expect(plotOfRecordKey('17,2020', ids)).toBe('17');
    expect(plotOfRecordKey('17a,x,y', ids)).toBe('17a');
    expect(plotOfRecordKey('171', ids)).toBeNull();
    expect(plotOfRecordKey('3,17', ids)).toBeNull();
  });
});
