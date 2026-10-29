import { describe, expect, it } from 'vitest';
import { buildPlotFile, parsePlotFile, type RoundColumn } from '../src/plots.js';
import { plotFileOf } from '../src/routes/division.js';
import { unitOfRecord } from '../src/rounds.js';

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

describe('plot files with a round column', () => {
  const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
  /** Round 2 on the plots in `copies`, 1 elsewhere. */
  const insert = (copies: string[]): RoundColumn => ({ kind: 'insert', value: (id) => (copies.includes(id) ? '2' : '1') });

  it('inserts round after the first column, with a header, for every separator', () => {
    for (const sep of [',', ';', '\t', '|']) {
      const j = (...fields: string[]) => fields.join(sep);
      const text = `${j('id', 'lat', 'lon', 'wkt')}\n${j('1', '0', '0', `"POLYGON((0 0${sep} 1 1,\n 2 2))"`)}\n${j('2', '1', '1', 'x')}\n`;
      const file = parse(text);
      expect(file.separator).toBe(sep);
      expect(buildPlotFile(file, null, insert(['2'])).toString('utf8')).toBe(
        `${j('id', 'round', 'lat', 'lon', 'wkt')}\n${j('1', '1', '0', '0', `"POLYGON((0 0${sep} 1 1,\n 2 2))"`)}\n${j('2', '2', '1', '1', 'x')}\n`,
      );
      expect(buildPlotFile(file, new Set(['2']), insert(['2'])).toString('utf8')).toBe(
        `${j('id', 'round', 'lat', 'lon', 'wkt')}\n${j('2', '2', '1', '1', 'x')}\n`,
      );
    }
  });

  it('inserts round without a header, after a quoted id, keeping a BOM, CRLF and a last row without a line break', () => {
    const text = Buffer.concat([BOM, Buffer.from('"1",0,0\r\n\r\n2,1,1\r\n1,5,5')]);
    const built = buildPlotFile(parse(text), null, insert(['1']));
    expect(built.subarray(0, 3)).toEqual(BOM);
    expect(built.subarray(3).toString('utf8')).toBe('"1",2,0,0\r\n2,1,1,1\r\n1,2,5,5');
    // Only plot 1: its last row gets no line break, the one before keeps its own.
    expect(buildPlotFile(parse(text), new Set(['1']), insert([])).subarray(3).toString('utf8')).toBe('"1",1,0,0\r\n1,1,5,5');
    // With a header, the header gets the column too; the last row stays without a break.
    const last = parse('id,lat,lon\r\n2,0,0\r\n1,1,1');
    expect(buildPlotFile(last, null, insert([])).toString('utf8')).toBe('id,round,lat,lon\r\n2,1,0,0\r\n1,1,1,1');
  });

  it('keeps the other bytes of a row exactly (Latin-1, spaces, quotes)', () => {
    const latin1 = Buffer.from('id,lat,lon,name\n 1 ,0,0,"Pe\xf1a ""x"""\n', 'latin1');
    expect(buildPlotFile(parse(latin1), null, insert([]))).toEqual(
      Buffer.from('id,round,lat,lon,name\n 1 ,1,0,0,"Pe\xf1a ""x"""\n', 'latin1'),
    );
  });

  it('replaces a column, quoting the value when it needs it, and leaves other rows and the header alone', () => {
    const text = 'id;round;lat;lon\n17;1;0;0\n17;"1";5;5\n18; 3 ;0;0\n19;1;0;0';
    const file = parsePlotFile(Buffer.from(text), 2);
    const replace = (value: string): RoundColumn => ({
      kind: 'replace',
      index: 1,
      value: (id, current) => (id === '17,1' ? value : current),
    });
    expect(buildPlotFile(file, null, replace('2')).toString('utf8')).toBe('id;round;lat;lon\n17;2;0;0\n17;2;5;5\n18; 3 ;0;0\n19;1;0;0');
    expect(buildPlotFile(file, null, replace('a;b')).toString('utf8')).toBe(
      'id;round;lat;lon\n17;"a;b";0;0\n17;"a;b";5;5\n18; 3 ;0;0\n19;1;0;0',
    );
    expect(buildPlotFile(file, new Set(['17,1']), replace('say "x"\n')).toString('utf8')).toBe(
      'id;round;lat;lon\n17;"say ""x""\n";0;0\n17;"say ""x""\n";5;5\n',
    );
    // A row too short for the column is left as it is.
    const short = parsePlotFile(Buffer.from('1;0;0\n2\n'), 1);
    expect(buildPlotFile(short, null, { kind: 'replace', index: 3, value: () => 'x' }).toString('utf8')).toBe('1;0;0\n2\n');
  });

  it('records where each field starts and ends', () => {
    const row = parse('id,lat,lon\n"1,2" , 0,0\n').rows[0];
    expect(row.fields).toEqual(['1,2', '0', '0']);
    expect(row.fieldStarts).toEqual([11, 18, 21]);
    expect(row.fieldEnds).toEqual([17, 20, 22]);
  });
});

describe('plotFileOf cache', () => {
  it('keeps one entry per checksum and key count', () => {
    const file = { checksum: 'cache-test-checksum', data: Buffer.from('id,year,lat,lon\n17,2020,0,0\n17,2021,1,1\n') };
    const one = plotFileOf(file, 1);
    const two = plotFileOf(file, 2);
    expect(one.plotIds).toEqual(['17']);
    expect(two.plotIds).toEqual(['17,2020', '17,2021']);
    expect(plotFileOf(file, 1)).toBe(one);
    expect(plotFileOf(file, 2)).toBe(two);
  });
});

describe('unitOfRecord (id-only survey)', () => {
  const ids = new Set(['17', '17a', '2']);
  it('matches the id, or the id followed by more key values', () => {
    expect(unitOfRecord('17', ids, null)).toBe('17');
    expect(unitOfRecord('17,2020', ids, null)).toBe('17');
    expect(unitOfRecord('17a,x,y', ids, null)).toBe('17a');
    expect(unitOfRecord('171', ids, null)).toBeNull();
    expect(unitOfRecord('3,17', ids, null)).toBeNull();
  });
});
