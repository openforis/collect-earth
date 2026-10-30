import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import * as zlib from 'node:zlib';
import { inflateRawSync } from 'node:zlib';
import { addRound, CepError, readCep, surveyInfo, zipCep } from '../src/cep.js';
import { cepWith, demoCep, FIXTURE_DATE, idOnlyCep, realDemoCep } from './fixtures/cep.js';

interface RawEntry {
  /** A Buffer name is written as is, without the UTF-8 flag. */
  name: string | Buffer;
  /** The file's content, or with `packed` its body as written in the zip. */
  data: string | Buffer;
  packed?: boolean;
  method?: number;
  flags?: number;
  crc?: number;
  size?: number;
  /** Point the central entry at an earlier local header instead of writing one. */
  localAt?: number;
  localName?: string;
  /** What the local header says, when it should differ from the central directory. */
  localMethod?: number;
  localCrc?: number;
  /** Zero CRC and sizes in the local header, as with bit 3 (sizes after the data). */
  localZeroes?: boolean;
}

/** A zip written by hand, saying whatever it is told to, for the reader's refusals. */
function rawZip(entries: RawEntry[], opts: { zip64Locator?: boolean; reverseCentral?: boolean } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.isBuffer(e.name) ? e.name : Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const method = e.method ?? 0;
    const body = method === 8 && !e.packed ? zlib.deflateRawSync(data) : data;
    const size = e.size ?? data.length;
    const crc = e.crc ?? (e.packed ? 0 : zlib.crc32(data));
    const flags = e.flags ?? 0;
    let localAt = e.localAt;
    if (localAt === undefined) {
      localAt = offset;
      const localName = e.localName === undefined ? name : Buffer.from(e.localName, 'utf8');
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(flags, 6);
      local.writeUInt16LE(e.localMethod ?? method, 8);
      if (!e.localZeroes) {
        local.writeUInt32LE(e.localCrc ?? crc, 14);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(size, 22);
      }
      local.writeUInt16LE(localName.length, 26);
      locals.push(local, localName, body);
      offset += 30 + localName.length + body.length;
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localAt, 42);
    centrals.push(Buffer.concat([central, name]));
  }
  if (opts.reverseCentral) centrals.reverse();
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const locator = Buffer.alloc(opts.zip64Locator ? 20 : 0);
  if (opts.zip64Locator) locator.writeUInt32LE(0x07064b50, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, locator, end]);
}

const surveyOf = (cep: Buffer) => {
  const files = readCep(cep);
  return surveyInfo(strFromU8(files.entries.get(files.surveyPath)!));
};

const cepErrorCode = (fn: () => unknown): string | null => {
  try {
    fn();
  } catch (e) {
    if (e instanceof CepError) return e.code;
    throw e;
  }
  return null;
};

/** A small survey whose root entity has the given children. */
const idm = (children: string, extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<survey lastId="42" xmlns="http://www.openforis.org/idml/3.0" xmlns:ui="http://www.openforis.org/collect/3.0/ui">
  <project>Small</project>
  ${extra}
  <codeLists>
    <list id="5" name="phases">
      <items>
        <item id="6"><code>01</code><label xml:lang="fr">Premier</label><label>First</label>
          <item id="7"><code>011</code><label>Nested</label></item>
        </item>
        <item id="8"><code>2</code><label xml:lang="es">Segunda</label></item>
      </items>
    </list>
    <list id="9" name="external" lookup="table_x" />
  </codeLists>
  <schema>
    <entity id="1" name="plot">
      ${children}
    </entity>
    <entity id="20" name="other" />
  </schema>
</survey>`;

describe('readCep', () => {
  it('finds the survey, balloons and template of the demo, keeping every entry in zip order', () => {
    const cep = demoCep();
    const files = readCep(cep);
    expect(files.surveyPath).toBe('placemark.idm.xml');
    expect(files.balloonPath).toBe('balloon.html');
    expect(files.balloonWebPath).toBe('balloon_web.html');
    expect(files.templatePath).toBe('kml_template.fmt');
    expect(files.entries.has('project_definition.properties')).toBe(true);
    expect([...files.entries.keys()]).toEqual(Object.keys(unzipSync(cep)));
  });

  it('keeps entries whose names look like numbers or object properties, in zip order', () => {
    const files = readCep(
      cepWith([
        ['placemark.idm.xml', idm('')],
        ['2', 'two'],
        ['constructor', 'c'],
        ['prototype', 'p'],
        ['1', 'one'],
      ]),
    );
    expect([...files.entries.keys()]).toEqual(['placemark.idm.xml', '2', 'constructor', 'prototype', '1']);
    expect(strFromU8(files.entries.get('constructor')!)).toBe('c');
  });

  it('refuses a zip with an entry named __proto__, or two entries with the same name', () => {
    expect(
      cepErrorCode(() => readCep(cepWith([['placemark.idm.xml', idm('')], ['__proto__', 'x']]))),
    ).toBe('not_a_zip');
    // Two entries of the same name length, then renamed alike in the zip's bytes.
    const twin = cepWith([['placemark.idm.xml', idm('')], ['aa.txt', 'first'], ['ab.txt', 'second']]);
    const duplicated = Buffer.from(twin.toString('latin1').split('ab.txt').join('aa.txt'), 'latin1');
    expect(cepErrorCode(() => readCep(duplicated))).toBe('not_a_zip');
  });

  it('strips a Windows-style ${project_path}\\ and reads continuation lines and CRLF files', () => {
    const files = readCep(
      cepWith({
        'project_definition.properties':
          '#c\r\nmetadata_file=${project_path}\\\\sur\\\r\n    vey.xml\r\nballoon=${project_path}\\\\b.html\r\n',
        'survey.xml': idm(''),
        'b.html': '<html/>',
      }),
    );
    expect(files.surveyPath).toBe('survey.xml');
    expect(files.balloonPath).toBe('b.html');
  });

  it('reads file locations from project_definition.properties, unescaping \\: and \\\\', () => {
    const files = readCep(
      cepWith({
        'project_definition.properties':
          '#comment\nmetadata_file=${project_path}/my\\:survey.xml\nballoon = ${project_path}/b\\\\x.html\n' +
          'template=${project_path}/missing.fmt\n',
        'my:survey.xml': idm(''),
        'b\\x.html': '<html/>',
        'kml_template.fmt': '<kml/>',
      }),
    );
    expect(files.surveyPath).toBe('my:survey.xml');
    expect(files.balloonPath).toBe('b\\x.html');
    // Named in the properties but missing from the zip: the usual file name is used.
    expect(files.templatePath).toBe('kml_template.fmt');
    expect(files.balloonWebPath).toBeNull();
  });

  it('falls back to the usual file names without a properties file', () => {
    const files = readCep(cepWith({ 'placemark.idm.xml': idm(''), 'balloon.html': '<html/>' }));
    expect(files.surveyPath).toBe('placemark.idm.xml');
    expect(files.balloonPath).toBe('balloon.html');
    expect(files.balloonWebPath).toBeNull();
    expect(files.templatePath).toBeNull();
  });

  it('refuses something that is not a zip', () => {
    expect(cepErrorCode(() => readCep(Buffer.from('just some text', 'utf8')))).toBe('not_a_zip');
  });

  it('refuses a zip without the survey', () => {
    expect(cepErrorCode(() => readCep(cepWith({ 'balloon.html': '<html/>' })))).toBe('no_survey');
  });

  it('refuses a zip that unzips to more than the limits allow', () => {
    const MB = 1024 * 1024;
    const big = (bytes: number) =>
      zipCep(new Map([['placemark.idm.xml', new Uint8Array(1)], ['b.bin', new Uint8Array(bytes)]]), FIXTURE_DATE);
    // Zeros deflate about 1000 to 1: a small upload may still unzip to 20 MB.
    expect(cepErrorCode(() => readCep(big(19 * MB)))).toBeNull();
    expect(cepErrorCode(() => readCep(big(21 * MB)))).toBe('too_large');
    // Explicit limits: total bytes, ratio (with its allowance), and the number of files.
    const limits = { maxEntries: 2000, maxTotalBytes: 200 * MB, maxRatio: 20, minAllowanceBytes: 0 };
    const text = cepWith({ 'placemark.idm.xml': 'x'.repeat(10_000) });
    expect(cepErrorCode(() => readCep(text, limits))).toBe('too_large');
    expect(cepErrorCode(() => readCep(text, { ...limits, maxRatio: 1000 }))).toBeNull();
    expect(cepErrorCode(() => readCep(text, { ...limits, maxRatio: 1000, maxTotalBytes: 9_999 }))).toBe('too_large');
    const many = cepWith(Array.from({ length: 2001 }, (_, i): [string, string] => [`f${i}`, '']));
    expect(cepErrorCode(() => readCep(many))).toBe('too_large');
    expect(() => readCep(many)).toThrow(/2,000 files/);
  });

  it('refuses a zip whose entries are shorter than the sizes it declares', () => {
    const zip = cepWith({ 'placemark.idm.xml': idm(''), 'b.txt': 'hello' });
    // Raise b.txt's declared size (central directory) from 5 to 6: its data comes up short.
    const centralAt = zip.readUInt32LE(zip.length - 22 + 16);
    let at = centralAt;
    for (;;) {
      const nameLength = zip.readUInt16LE(at + 28);
      if (zip.toString('utf8', at + 46, at + 46 + nameLength) === 'b.txt') break;
      at += 46 + nameLength;
    }
    zip.writeUInt32LE(6, at + 24);
    expect(cepErrorCode(() => readCep(zip))).toBe('not_a_zip');
  });

  it('reads the real demo (made by Java) exactly as fflate does, entry for entry and in order', () => {
    const demo = realDemoCep();
    const ours = readCep(demo).entries;
    const theirs = unzipSync(demo);
    expect([...ours.keys()]).toEqual(Object.keys(theirs));
    for (const [name, bytes] of ours) expect(Buffer.from(bytes).equals(Buffer.from(theirs[name])), name).toBe(true);
  });

  it('reads a central directory in another order than the files lie, keeping its order', () => {
    const zip = rawZip(
      [
        { name: 'placemark.idm.xml', data: idm('') },
        { name: 'a.txt', data: 'first', method: 8 },
        { name: 'b.txt', data: 'second' },
      ],
      { reverseCentral: true },
    );
    const files = readCep(zip);
    expect([...files.entries.keys()]).toEqual(['b.txt', 'a.txt', 'placemark.idm.xml']);
    expect(strFromU8(files.entries.get('a.txt')!)).toBe('first');
    expect(strFromU8(files.entries.get('b.txt')!)).toBe('second');
  });

  it('caps the survey, the balloons and the template, naming the file and the limit', () => {
    const MB = 1024 * 1024;
    const tooLarge = (cep: Buffer) => {
      const started = performance.now();
      const message = (() => {
        try {
          readCep(cep);
        } catch (e) {
          if (e instanceof CepError && e.code === 'too_large') return e.message;
          throw e;
        }
        return null;
      })();
      expect(performance.now() - started).toBeLessThan(5000); // catches a hang, not a speed
      return message;
    };
    const big = (bytes: number) => Buffer.alloc(bytes, 0x20);
    expect(tooLarge(cepWith({ 'placemark.idm.xml': big(11 * MB) }))).toMatch(
      /survey \(placemark\.idm\.xml\) is larger than 10 MB/,
    );
    expect(tooLarge(cepWith({ 'placemark.idm.xml': idm(''), 'balloon.html': big(6 * MB) }))).toMatch(
      /balloon \(balloon\.html\) is larger than 5 MB/,
    );
    expect(tooLarge(cepWith({ 'placemark.idm.xml': idm(''), 'kml_template.fmt': big(6 * MB) }))).toMatch(
      /KML template \(kml_template\.fmt\) is larger than 5 MB/,
    );
    // Any other file may be larger.
    expect(tooLarge(cepWith({ 'placemark.idm.xml': idm(''), 'grid/plots.csv': big(12 * MB) }))).toBeNull();
  }, 30_000);

  it('takes a Uint8Array as well as a Buffer', () => {
    const zip = demoCep();
    const copy = new Uint8Array(zip.length + 8).subarray(4, 4 + zip.length);
    copy.set(zip);
    expect([...readCep(copy).entries.keys()]).toEqual([...readCep(zip).entries.keys()]);
  });

  it('reads names without the UTF-8 flag one byte per character, as fflate does', () => {
    const zip = rawZip([
      { name: 'placemark.idm.xml', data: idm('') },
      { name: Buffer.from([0x63, 0xf1, 0x2e, 0x74]), data: 'x' },
    ]);
    expect([...readCep(zip).entries.keys()]).toEqual(['placemark.idm.xml', 'cñ.t']);
    expect([...readCep(zip).entries.keys()]).toEqual(Object.keys(unzipSync(zip)));
  });

  describe('refuses zips that lie about their contents', () => {
    const survey = { name: 'placemark.idm.xml', data: idm('') };
    const refusal = (zip: Buffer) => {
      try {
        readCep(zip);
      } catch (e) {
        if (e instanceof CepError) return { code: e.code, message: e.message };
        throw e;
      }
      return null;
    };

    it('many files pointing at one stored body: refused before anything is copied', () => {
      const MB = 1024 * 1024;
      const body = Buffer.alloc(MB);
      const zip = rawZip([
        { name: 'placemark.idm.xml', data: body },
        ...Array.from({ length: 15 }, (_, i): RawEntry => ({ name: `copy${i}`, data: body, localAt: 0 })),
      ]);
      expect(zip.length).toBeLessThan(2 * MB);
      const started = performance.now();
      expect(refusal(zip)?.code).toBe('not_a_zip');
      expect(performance.now() - started).toBeLessThan(5000); // catches a hang, not a speed
    }, 30_000);

    it('a stored file whose sizes disagree', () => {
      expect(refusal(rawZip([survey, { name: 'b.txt', data: 'hello', size: 3 }]))).toMatchObject({
        code: 'not_a_zip',
        message: expect.stringMatching(/a file inside it \(b\.txt\) is damaged/),
      });
    });

    it('a deflated file longer than it declares', () => {
      const data = Buffer.from('hello world, hello world');
      expect(
        refusal(rawZip([survey, { name: 'b.txt', data, method: 8, size: 5, crc: zlib.crc32(data.subarray(0, 5)) }]))
          ?.code,
      ).toBe('not_a_zip');
    });

    it('a deflate bomb declared tiny fails fast', () => {
      const bomb = zlib.deflateRawSync(Buffer.alloc(64 * 1024 * 1024));
      for (const size of [10, 0]) {
        const zip = rawZip([survey, { name: 'bomb', data: bomb, method: 8, size, packed: true }]);
        const started = performance.now();
        expect(refusal(zip)?.code).toBe('not_a_zip');
        expect(performance.now() - started).toBeLessThan(5000); // catches a hang, not a speed
      }
    }, 30_000);

    it('accepts an empty deflated file, but not one that inflates to something', () => {
      const empty = zlib.deflateRawSync(Buffer.alloc(0));
      expect(refusal(rawZip([survey, { name: 'e', data: empty, method: 8, size: 0, crc: 0, packed: true }]))).toBeNull();
      const x = zlib.deflateRawSync(Buffer.from('x'));
      expect(refusal(rawZip([survey, { name: 'e', data: x, method: 8, size: 0, crc: 0, packed: true }]))?.code).toBe(
        'not_a_zip',
      );
    });

    it('a file whose checksum is wrong', () => {
      expect(refusal(rawZip([survey, { name: 'b.txt', data: 'hello', crc: 1234 }]))?.message).toMatch(/damaged/);
    });

    it('an encrypted file, a method other than stored or deflate, a local name unlike the central one', () => {
      expect(refusal(rawZip([survey, { name: 'b.txt', data: 'hello', flags: 1 }]))?.message).toMatch(/password/);
      expect(refusal(rawZip([survey, { name: 'b.txt', data: 'hello', method: 12 }]))?.message).toMatch(/compressed/);
      expect(refusal(rawZip([survey, { name: 'b.txt', data: 'hello', localName: 'c.txt' }]))?.code).toBe('not_a_zip');
    });

    it('ZIP64 markers and zips split over several parts', () => {
      expect(refusal(rawZip([survey, { name: 'b.txt', data: 'x', size: 0xffffffff }]))?.message).toMatch(/ZIP64/);
      const withLocator = rawZip([survey], { zip64Locator: true });
      expect(refusal(withLocator)?.message).toMatch(/ZIP64/);
      const split = rawZip([survey]);
      split.writeUInt16LE(1, split.length - 22 + 4);
      expect(refusal(split)?.message).toMatch(/several parts/);
    });

    it('a local header that disagrees with the central directory', () => {
      const local = (e: Partial<RawEntry>) => refusal(rawZip([survey, { name: 'b.txt', data: 'hello', ...e }]))?.code ?? null;
      expect(local({ method: 8, localMethod: 0 })).toBe('not_a_zip');
      expect(local({ localCrc: 1234 })).toBe('not_a_zip');
      expect(local({ localZeroes: true })).toBe('not_a_zip');
      // With bit 3 the local header may leave them out, as Java writes deflated files.
      expect(local({ method: 8, flags: 8, localZeroes: true })).toBeNull();
    });

    it('a central directory with more entries than the end record says', () => {
      const zip = rawZip([survey, { name: 'hidden.txt', data: 'x' }]);
      zip.writeUInt16LE(1, zip.length - 22 + 8);
      zip.writeUInt16LE(1, zip.length - 22 + 10);
      expect(refusal(zip)?.code).toBe('not_a_zip');
    });

    it('a central directory pointing outside the zip', () => {
      const zip = rawZip([survey]);
      zip.writeUInt32LE(zip.length, zip.length - 22 + 16);
      expect(refusal(zip)?.code).toBe('not_a_zip');
    });
  });

  it('names the survey file the properties point to when it is missing', () => {
    const missing = cepWith({ 'project_definition.properties': 'metadata_file=${project_path}/mine.idm.xml\n' });
    expect(() => readCep(missing)).toThrow(/mine\.idm\.xml/);
  });
});

describe('surveyInfo', () => {
  it('reads the demo survey: two keys, its code lists, languages and lastId', () => {
    const info = surveyOf(demoCep());
    expect(info.rootEntity).toBe('plot');
    expect(info.rootEntityCount).toBe(1);
    expect(info.keys).toEqual([
      { name: 'id', type: 'text', list: null },
      { name: 'round', type: 'code', list: 'assessment_phases' },
    ]);
    expect(info.hasNonKeyRound).toBe(false);
    expect(info.codeLists.get('assessment_phases')).toEqual([
      { code: '1', label: 'First assessment' },
      { code: '2', label: 'Re-Assessment' },
    ]);
    expect(info.codeLists.get('years')!.map((i) => i.code).slice(0, 2)).toEqual(['2025', '2024']);
    expect(info.languages).toEqual(['en', 'fr', 'pt', 'es']);
    expect(info.lastId).toBe(2013037);
  });

  it('reads the id-only demo: one key, id', () => {
    const info = surveyOf(idOnlyCep());
    expect(info.keys).toEqual([{ name: 'id', type: 'text', list: null }]);
    expect(info.hasNonKeyRound).toBe(false);
    expect(info.codeLists.has('assessment_phases')).toBe(true);
  });

  it('notices a round attribute that is not a key', () => {
    const info = surveyInfo(
      idm('<text id="2" name="id" key="true"/><code id="3" name="round" list="phases"/>'),
    );
    expect(info.keys).toEqual([{ name: 'id', type: 'text', list: null }]);
    expect(info.hasNonKeyRound).toBe(true);
  });

  it('keeps codes as written, takes the default-language label (else the first), and only top-level items', () => {
    const info = surveyInfo(idm('<text id="2" name="id" key="true"/>'));
    expect(info.codeLists.get('phases')).toEqual([
      { code: '01', label: 'First' },
      { code: '2', label: 'Segunda' },
    ]);
    expect(info.codeLists.get('external')).toEqual([]);
    expect(info.rootEntityCount).toBe(2);
    expect(info.languages).toEqual([]);
    expect(info.lastId).toBe(42);
  });

  it('ignores keys of nested entities', () => {
    const info = surveyInfo(
      idm('<text id="2" name="id" key="true"/><entity id="4" name="lc"><code id="5" name="el" key="true" list="phases"/></entity>'),
    );
    expect(info.keys.map((k) => k.name)).toEqual(['id']);
  });

  it('decodes character references in labels and attribute values', () => {
    const info = surveyInfo(
      idm('<text id="2" name="id" key="true"/>').replace(
        '<label>First</label>',
        '<label>Caf&#233; &#x2019;s &amp; co</label>',
      ).replace('name="phases"', 'name="ph&#228;ses"'),
    );
    expect(info.codeLists.get('phäses')![0].label).toBe('Café ’s & co');
  });

  it('takes the label of the default language when no label is unmarked', () => {
    const info = surveyInfo(
      idm('<text id="2" name="id" key="true"/>', '<language>es</language><language>fr</language>').replace(
        '<label xml:lang="fr">Premier</label><label>First</label>',
        '<label xml:lang="fr">Premier</label><label xml:lang="es">Primero</label>',
      ),
    );
    expect(info.codeLists.get('phases')![0].label).toBe('Primero');
  });

  it('refuses a survey with a DOCTYPE, so no entity of it is ever expanded', () => {
    const withDoctype = idm('<text id="2" name="id" key="true"/>')
      .replace('<survey ', '<!DOCTYPE survey [<!ENTITY boom "EXPANDED">]>\n<survey ')
      .replace('<label>First</label>', '<label>&boom;</label>');
    expect(cepErrorCode(() => surveyInfo(withDoctype))).toBe('survey_unreadable');
  });

  it('refuses XML it cannot read, or a survey without a schema entity', () => {
    expect(cepErrorCode(() => surveyInfo('<foo/>'))).toBe('survey_unreadable');
    expect(cepErrorCode(() => surveyInfo('<survey><schema></survey>'))).toBe('survey_unreadable');
    expect(cepErrorCode(() => surveyInfo('not xml at all'))).toBe('survey_unreadable');
    expect(cepErrorCode(() => surveyInfo('<survey lastId="1"><schema/></survey>'))).toBe('survey_unreadable');
  });
});

describe('test CEP fixtures', () => {
  it('the demo CEP leaves out the survey guide but keeps the survey', () => {
    const files = unzipSync(demoCep());
    expect(files['survey_guide.pdf']).toBeUndefined();
    expect(strFromU8(files['placemark.idm.xml'])).toContain('name="round"');
  });

  it('the id-only CEP has no round key anywhere', () => {
    const files = unzipSync(idOnlyCep());
    const idm = strFromU8(files['placemark.idm.xml']);
    expect(idm).not.toContain('name="round"');
    expect(idm).toContain('name="assessment_phases"');
    for (const balloon of ['balloon.html', 'balloon_web.html']) {
      const html = strFromU8(files[balloon]);
      expect(html).not.toContain('id="collect_code_round"');
      expect(html).not.toContain("'collect_code_round'");
      expect(html).toMatch(/EXTRA_ID_ATTRIBUTES = \['collect_text_id'\];/);
    }
    const template = strFromU8(files['kml_template.fmt']);
    expect(template).not.toContain('EXTRA_round');
    expect(template).toContain('EXTRA_id');
  });

  it('cepWith zips the given entries', () => {
    const files = unzipSync(cepWith({ 'a.txt': 'hello', 'b.bin': Buffer.from([1, 2]) }));
    expect(strFromU8(files['a.txt'])).toBe('hello');
    expect(Array.from(files['b.bin'])).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------------------
// addRound

const text = (cep: Buffer, path: string) => strFromU8(readCep(cep).entries.get(path)!);
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const BALLOON_MARKER = '<!-- START OF EXTRA CSV DATA -->';
const TEMPLATE_MARKER =
  '<!-- DO NOT REMOVE THIS LINE - IT GENERATES THE EXTRA FIELDS FROM THE CSV-BALLOON INTEGRATION -->';
const NS = 'xmlns="http://www.openforis.org/idml/3.0" xmlns:ui="http://www.openforis.org/collect/3.0/ui"';

/** A small id-only survey, in the shape Collect writes. */
const miniIdm = (opts: { lists?: string; children?: string; surveyAttrs?: string; codeLists?: boolean } = {}) => {
  const children =
    opts.children ??
    `<text id="2" name="id" required="true" ui:tab="t1" key="true" type="short">
        <label type="instance">Plot ID</label>
      </text>
      <text id="3" name="notes" ui:tab="t1"/>`;
  const codeLists =
    opts.codeLists === false
      ? ''
      : `
  <codeLists>
    <list id="5" name="colours">
      <items>
        <item id="6"><code>r</code><label>Red</label></item>
      </items>
    </list>${opts.lists ?? ''}
  </codeLists>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<survey ${opts.surveyAttrs ?? `lastId="40" ${NS}`}>
  <project>Small</project>
  <language>en</language>
  <language>es</language>${codeLists}
  <schema>
    <entity id="1" name="plot" ui:tab="plot_tab">
      ${children}
    </entity>
  </schema>
</survey>
`;
};
const miniBalloon = (eol = '\n') =>
  [
    '<html><head><script>',
    "    var EXTRA_ID_ATTRIBUTES = ['collect_text_id'];",
    '</script></head><body>',
    BALLOON_MARKER,
    '<input type="hidden" id="collect_text_id" name="collect_text_id" value="$[EXTRA_id]" class="extra" />',
    '</body></html>',
    '',
  ].join(eol);
const miniTemplate = () =>
  [
    '<kml><ExtendedData>',
    TEMPLATE_MARKER,
    '<Data name="EXTRA_id">',
    '<value>${placemark.idColumns[0]}</value>',
    '</Data>',
    '</ExtendedData></kml>',
    '',
  ].join('\n');

const miniCep = (over: Record<string, string | null> = {}): Buffer => {
  const files: Record<string, string | null> = {
    'placemark.idm.xml': miniIdm(),
    'balloon.html': miniBalloon(),
    'kml_template.fmt': miniTemplate(),
    'grid/plots.csv': 'id,lat,lon\n1,0,0\n',
    ...over,
  };
  return cepWith(Object.entries(files).filter((e): e is [string, string] => e[1] !== null));
};

describe('zipCep', () => {
  const date = new Date(Date.UTC(2026, 9, 29, 14, 37, 58));

  it('re-zips the real demo (made by Java) entry for entry, in order, readable by fflate', () => {
    const original = readCep(realDemoCep()).entries;
    const again = zipCep(original, date);
    const back = unzipSync(again);
    expect(Object.keys(back)).toEqual([...original.keys()]);
    for (const [name, bytes] of original) {
      expect(Buffer.from(back[name]).equals(Buffer.from(bytes)), name).toBe(true);
    }
    // The same entries and date always give the same bytes; another date, other bytes.
    expect(zipCep(original, new Date(date)).equals(again)).toBe(true);
    expect(zipCep(original, new Date(Date.UTC(2026, 9, 29, 14, 38, 0))).equals(again)).toBe(false);
  });

  it('reads back with an independent reader: its own central directory walk and node:zlib', () => {
    const original = readCep(realDemoCep()).entries;
    const zip = zipCep(original, date);
    const end = zip.length - 22;
    expect(zip.readUInt32LE(end)).toBe(0x06054b50);
    const count = zip.readUInt16LE(end + 10);
    expect(count).toBe(original.size);
    let at = zip.readUInt32LE(end + 16);
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      expect(zip.readUInt32LE(at)).toBe(0x02014b50);
      const method = zip.readUInt16LE(at + 10);
      const dosTime = zip.readUInt16LE(at + 12);
      const dosDate = zip.readUInt16LE(at + 14);
      const compressedSize = zip.readUInt32LE(at + 20);
      const size = zip.readUInt32LE(at + 24);
      const nameLength = zip.readUInt16LE(at + 28);
      const extraLength = zip.readUInt16LE(at + 30);
      const commentLength = zip.readUInt16LE(at + 32);
      const localAt = zip.readUInt32LE(at + 42);
      const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
      names.push(name);
      // 2026-10-29 14:37:58 UTC: the bytes do not depend on the time zone of the server.
      expect(dosDate).toBe(((2026 - 1980) << 9) | (10 << 5) | 29);
      expect(dosTime).toBe((14 << 11) | (37 << 5) | 29);

      expect(zip.readUInt32LE(localAt)).toBe(0x04034b50);
      const bodyAt = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28);
      const body = zip.subarray(bodyAt, bodyAt + compressedSize);
      const data = method === 8 ? inflateRawSync(body) : method === 0 ? body : null;
      expect(data, name).not.toBeNull();
      expect(data!.length).toBe(size);
      expect(Buffer.from(data!).equals(Buffer.from(original.get(name)!)), name).toBe(true);
      at += 46 + nameLength + extraLength + commentLength;
    }
    expect(names).toEqual([...original.keys()]);
  });

  it('refuses what would need ZIP64 with a clear message', () => {
    const many = new Map<string, Uint8Array>();
    for (let i = 0; i < 0xffff; i++) many.set(`f${i}`, new Uint8Array());
    expect(() => zipCep(many, date)).toThrow(/too large for a zip without ZIP64/);
    many.delete('f0');
    const fits = zipCep(many, date);
    expect(fits.readUInt16LE(fits.length - 12)).toBe(0xfffe);
  });

  it('stamps the served file with the date addRound is given', () => {
    const { cep } = addRound(miniCep(), date);
    // The first central directory entry follows all local entries; its date fields:
    const centralAt = cep.readUInt32LE(cep.length - 22 + 16);
    expect(cep.readUInt16LE(centralAt + 14)).toBe(((2026 - 1980) << 9) | (10 << 5) | 29);
    expect(addRound(miniCep(), new Date(date)).cep.equals(cep)).toBe(true);
  });

  it('stores what does not shrink, and keeps empty entries and UTF-8 names', () => {
    const entries = new Map<string, Uint8Array>([
      ['dir/', new Uint8Array()],
      ['dir/ñandú.txt', new Uint8Array(Buffer.from('ñandú'.repeat(50)))],
      ['tiny', new Uint8Array([7])],
    ]);
    const back = readCep(cepWith([['placemark.idm.xml', idm('')], ...[...entries].map(([n, d]): [string, Buffer] => [n, Buffer.from(d)])]));
    for (const [name, bytes] of entries) expect(Buffer.from(back.entries.get(name)!).equals(Buffer.from(bytes))).toBe(true);
  });
});

describe('addRound', () => {
  it('adds a hidden round key to the id-only demo, reusing its assessment_phases list', () => {
    const original = idOnlyCep();
    const { cep, info } = addRound(original);
    expect(info).toEqual({
      state: 'added',
      refusal: null,
      keyCount: 2,
      roundIndex: 1,
      roundCodes: [
        { code: '1', label: 'First assessment' },
        { code: '2', label: 'Re-Assessment' },
      ],
      reassessmentCode: '2',
    });
    const survey = surveyOf(cep);
    expect(survey.keys).toEqual([
      { name: 'id', type: 'text', list: null },
      { name: 'round', type: 'code', list: 'assessment_phases' },
    ]);
    expect([...survey.codeLists.keys()].filter((n) => n.startsWith('assessment_phases'))).toEqual([
      'assessment_phases',
    ]);
    expect(survey.lastId).toBe(2013038);

    const idmText = text(cep, 'placemark.idm.xml');
    const roundTag = /<code id="2013038" name="round"[^>]*>/.exec(idmText)![0];
    expect(roundTag).toContain('collectearth:hideinrecordlist="true"');
    expect(roundTag).toContain('collectearth:fromcsv="true"');
    expect(roundTag).toContain('collect:measurement="true"');
    expect(roundTag).toContain('ui:tab="tab_10007"');

    for (const balloon of ['balloon.html', 'balloon_web.html']) {
      const html = text(cep, balloon);
      expect(count(html, 'id="collect_code_round"')).toBe(1);
      expect(html).toMatch(/EXTRA_ID_ATTRIBUTES = \['collect_text_id', 'collect_code_round'\];/);
    }
    expect(count(text(cep, 'kml_template.fmt'), '<Data name="EXTRA_round">')).toBe(1);

    const before = readCep(original).entries;
    const after = readCep(cep).entries;
    expect([...after.keys()]).toEqual([...before.keys()]);
    const changed = ['placemark.idm.xml', 'balloon.html', 'balloon_web.html', 'kml_template.fmt'];
    for (const [name, bytes] of before) {
      if (changed.includes(name)) continue;
      expect(Buffer.from(after.get(name)!).equals(Buffer.from(bytes)), name).toBe(true);
    }
  });

  it('leaves a CEP it has already changed alone: its survey now has its own round', () => {
    const once = addRound(idOnlyCep()).cep;
    const twice = addRound(once);
    expect(twice.info.state).toBe('own');
    expect(twice.cep.equals(once)).toBe(true);
  });

  it('leaves the demo alone: it has its own round, codes 1 and 2', () => {
    const original = demoCep();
    const { cep, info } = addRound(original);
    expect(cep.equals(original)).toBe(true);
    expect(info).toEqual({
      state: 'own',
      refusal: null,
      keyCount: 2,
      roundIndex: 1,
      roundCodes: [
        { code: '1', label: 'First assessment' },
        { code: '2', label: 'Re-Assessment' },
      ],
      reassessmentCode: '2',
    });
  });

  it('an own round without code 2 has no re-assessment code until the coordinator picks one', () => {
    const years = `
    <list id="30" name="years"><items><item id="31"><code>2024</code><label>2024</label></item><item id="32"><code>2025</code><label>2025</label></item></items></list>`;
    const { info } = addRound(
      miniCep({
        'placemark.idm.xml': miniIdm({
          lists: years,
          children: '<code id="4" name="round" key="true" list="years"/><text id="2" name="id" key="true"/>',
        }),
      }),
    );
    expect(info).toMatchObject({ state: 'own', keyCount: 2, roundIndex: 0, reassessmentCode: null });
    expect(info.roundCodes.map((c) => c.code)).toEqual(['2024', '2025']);
  });

  it('adds a new list, assessment_phases_2, when assessment_phases lacks code 2', () => {
    const taken = `
    <list id="30" name="assessment_phases"><items><item id="31"><code>1</code><label>One</label></item></items></list>`;
    const { cep, info } = addRound(miniCep({ 'placemark.idm.xml': miniIdm({ lists: taken }) }));
    expect(info.state).toBe('added');
    expect(info.roundCodes).toEqual([
      { code: '1', label: 'First assessment' },
      { code: '2', label: 'Re-assessment' },
    ]);
    const survey = surveyOf(cep);
    expect(survey.keys[1]).toEqual({ name: 'round', type: 'code', list: 'assessment_phases_2' });
    expect(survey.lastId).toBe(44);
    const idmText = text(cep, 'placemark.idm.xml');
    expect(idmText).toContain('<code id="41" name="round"');
    expect(idmText).toContain('<list id="42" name="assessment_phases_2">');
    expect(idmText).toContain('<item id="43"><code>1</code>');
    expect(idmText).toContain('<item id="44"><code>2</code>');
    // The survey's own languages: English unmarked, Spanish marked; no French or Portuguese.
    expect(idmText).toContain('<label xml:lang="es">Reevaluaci&#243;n</label>');
    expect(idmText).not.toContain('xml:lang="fr"');
    // The old list is untouched.
    expect(survey.codeLists.get('assessment_phases')).toEqual([{ code: '1', label: 'One' }]);
  });

  it('keeps ids above every id in the survey, and adds the namespaces it uses', () => {
    const { cep } = addRound(miniCep({ 'placemark.idm.xml': miniIdm({ surveyAttrs: `lastId="3" ${NS}` }) }));
    const idmText = text(cep, 'placemark.idm.xml');
    // lastId says 3, but ids up to 6 are in use.
    expect(idmText).toContain('<code id="7" name="round"');
    expect(surveyOf(cep).lastId).toBe(10);
    const surveyTag = /<survey [^>]*>/.exec(idmText)![0];
    expect(surveyTag).toContain('xmlns:collect="http://www.openforis.org/collect/3.0/collect"');
    expect(surveyTag).toContain('xmlns:collectearth="http://www.openforis.org/collect/3.0/collectearth"');
    expect(count(surveyTag, 'xmlns:ui=')).toBe(1);
  });

  it('creates the code lists section when the survey has none, and leaves out ui:tab when id has none', () => {
    const { cep, info } = addRound(
      miniCep({ 'placemark.idm.xml': miniIdm({ codeLists: false, children: '<text id="2" name="id" key="true"/>' }) }),
    );
    expect(info.state).toBe('added');
    const survey = surveyOf(cep);
    expect(survey.codeLists.get('assessment_phases')!.map((c) => c.code)).toEqual(['1', '2']);
    const idmText = text(cep, 'placemark.idm.xml');
    expect(idmText.indexOf('<codeLists>')).toBeLessThan(idmText.indexOf('<schema>'));
    expect(/<code id="\d+" name="round"[^>]*>/.exec(idmText)![0]).not.toContain('ui:tab');
  });

  it('replaces an empty <codeLists/> in place, without leaving an empty line', () => {
    const empty = miniIdm({ codeLists: false }).replace('<language>es</language>', '<language>es</language>\n  <codeLists/>');
    const { cep, info } = addRound(miniCep({ 'placemark.idm.xml': empty }));
    expect(info.state).toBe('added');
    const idmText = text(cep, 'placemark.idm.xml');
    expect(idmText).not.toContain('<codeLists/>');
    expect(idmText).not.toMatch(/\n[ \t]*\n/);
    expect(idmText).toContain('<language>es</language>\n  <codeLists>\n    <list id="42" name="assessment_phases">');
    expect(idmText).toContain('    </list>\n  </codeLists>\n  <schema>');
  });

  it('refuses as unreadable a survey whose key it cannot find in the text', () => {
    // The parser decodes &#105; to "i"; the in-place editor matches names as written.
    const odd = miniIdm({ children: '<text id="2" name="&#105;d" key="true"/>' });
    const original = miniCep({ 'placemark.idm.xml': odd });
    const { cep, info } = addRound(original);
    expect(info).toMatchObject({ state: 'none', refusal: 'survey_unreadable', keyCount: 1 });
    expect(cep.equals(original)).toBe(true);
  });

  it('puts round right after the id key, with its indentation', () => {
    const { cep } = addRound(miniCep());
    const idmText = text(cep, 'placemark.idm.xml');
    expect(idmText).toMatch(
      /<\/text>\n      <code id="41" name="round"[^>]*>\n        <label type="instance">Assessment round<\/label>/,
    );
    expect(idmText.indexOf('name="round"')).toBeLessThan(idmText.indexOf('name="notes"'));
  });

  it("inserts into a CRLF balloon with CRLF only, after the marker", () => {
    const { cep } = addRound(miniCep({ 'balloon.html': miniBalloon('\r\n') }));
    const html = text(cep, 'balloon.html');
    expect(html.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(html).toContain(
      `${BALLOON_MARKER}\r\n<input type="hidden" id="collect_code_round" name="collect_code_round" value="$[EXTRA_round]" class="extra" />\r\n`,
    );
    const template = text(cep, 'kml_template.fmt');
    expect(template).toContain(
      `${TEMPLATE_MARKER}\n<Data name="EXTRA_round">\n<value>\${placemark.idColumns[1]}</value>\n</Data>\n`,
    );
  });

  it('follows the quotes and spacing of EXTRA_ID_ATTRIBUTES', () => {
    const balloon = miniBalloon().replace("['collect_text_id']", '["collect_text_id","collect_text_other"]');
    const { cep } = addRound(miniCep({ 'balloon.html': balloon }));
    expect(text(cep, 'balloon.html')).toContain(
      'EXTRA_ID_ATTRIBUTES = ["collect_text_id","collect_text_other","collect_code_round"]',
    );
  });

  it('puts the template entry after EXTRA_id when the marker is missing', () => {
    const template = miniTemplate().replace(`${TEMPLATE_MARKER}\n`, '');
    const { cep } = addRound(miniCep({ 'kml_template.fmt': template }));
    expect(text(cep, 'kml_template.fmt')).toContain(
      '<value>${placemark.idColumns[0]}</value>\n</Data>\n<Data name="EXTRA_round">\n',
    );
  });

  it('names the Placemarks of the demo template by the visible id, so Google Earth does not show round', () => {
    const before = text(idOnlyCep(), 'kml_template.fmt');
    expect(before).toContain('<Placemark id="${placemark.placemarkId}">\n\t\t<name>${placemark.placemarkId}</name>');
    const template = text(addRound(idOnlyCep()).cep, 'kml_template.fmt');
    expect(template).toContain(
      '<Placemark id="${placemark.placemarkId}">\n\t\t<name>${placemark.visiblePlacemarkId!""}</name>',
    );
    expect(template).not.toMatch(/<name>[^<]*\$\{placemark\.placemarkId\}[^<]*<\/name>/);
    // Everything else keeps the whole id: the element ids, the icon URL, the folder name's own fallback
    expect(count(template, '${placemark.placemarkId}')).toBe(count(before, '${placemark.placemarkId}') - 1);
    expect(template).toContain('placemarkIconExtd?id=${placemark.placemarkId}');
  });

  it('changes only the plain-text name of a Placemark', () => {
    const template = miniTemplate().replace(
      '</ExtendedData></kml>',
      [
        '</ExtendedData>',
        '<Folder><name>${placemark.placemarkId}</name></Folder>',
        '<Placemark id="p_${placemark.placemarkId}">\r\n  <name>Plot ${placemark.placemarkId}</name></Placemark>',
        '<Placemark><styleUrl>#s</styleUrl><name>${placemark.placemarkId}</name></Placemark>',
        '</kml>',
      ].join('\n'),
    );
    const served = text(addRound(miniCep({ 'kml_template.fmt': template })).cep, 'kml_template.fmt');
    expect(served).toContain(
      '<Placemark id="p_${placemark.placemarkId}">\r\n  <name>Plot ${placemark.visiblePlacemarkId!""}</name>',
    );
    expect(served).toContain('<Folder><name>${placemark.placemarkId}</name></Folder>');
    expect(served).toContain('<styleUrl>#s</styleUrl><name>${placemark.visiblePlacemarkId!""}</name>');
  });

  const idmWith = (children: string) => miniIdm({ children });
  const refusals: Array<[string, () => Buffer]> = [
    ['not_a_zip', () => Buffer.from('plain text')],
    ['no_survey', () => miniCep({ 'placemark.idm.xml': null })],
    ['survey_unreadable', () => miniCep({ 'placemark.idm.xml': '<survey><schema></survey>' })],
    [
      'several_entities',
      () => miniCep({ 'placemark.idm.xml': miniIdm().replace('</schema>', '<entity id="9" name="other"/>\n  </schema>') }),
    ],
    [
      'round_not_key',
      () =>
        miniCep({
          'placemark.idm.xml': idmWith('<text id="2" name="id" key="true"/><code id="4" name="round" list="colours"/>'),
        }),
    ],
    [
      'several_keys',
      () => miniCep({ 'placemark.idm.xml': idmWith('<text id="2" name="id" key="true"/><text id="4" name="b" key="true"/>') }),
    ],
    ['several_keys', () => miniCep({ 'placemark.idm.xml': idmWith('<text id="2" name="id"/>') })],
    ['balloon_missing', () => miniCep({ 'balloon.html': null })],
    ['balloon_marker_missing', () => miniCep({ 'balloon.html': miniBalloon().replace(BALLOON_MARKER, '') })],
    [
      'balloon_ids_missing',
      () => miniCep({ 'balloon.html': miniBalloon().replace(/var EXTRA_ID_ATTRIBUTES[^\n]*/, '') }),
    ],
    ['balloon_marker_missing', () => miniCep({ 'balloon_web.html': miniBalloon().replace(BALLOON_MARKER, '') })],
    ['balloon_ids_missing', () => miniCep({ 'balloon_web.html': miniBalloon().replace("'collect_text_id'", '') })],
    ['template_missing', () => miniCep({ 'kml_template.fmt': null })],
    ['template_marker_missing', () => miniCep({ 'kml_template.fmt': '<kml><ExtendedData></ExtendedData></kml>\n' })],
  ];
  for (const [code, make] of refusals) {
    it(`refuses with ${code} and hands back the original bytes`, () => {
      const original = make();
      const { cep, info } = addRound(original);
      expect(info.refusal).toBe(code);
      expect(info.state).toBe('none');
      expect(info.roundIndex).toBeNull();
      expect(info.reassessmentCode).toBeNull();
      expect(info.roundCodes).toEqual([]);
      expect(cep.equals(original)).toBe(true);
    });
  }

  it('reads the served file back within the limits the upload had, however small it zips', () => {
    // Stored, the upload is as big as its contents; deflated, the served file is far smaller.
    const files = readCep(miniCep({ 'notes.txt': 'x'.repeat(200_000) })).entries;
    const stored = rawZip([...files].map(([name, data]): RawEntry => ({ name, data: Buffer.from(data) })));
    const limits = { maxEntries: 2000, maxTotalBytes: 200 * 1024 * 1024, maxRatio: 1.1, minAllowanceBytes: 0 };
    const { cep, info } = addRound(stored, new Date(), limits);
    expect(info.state).toBe('added');
    expect(cep.length * limits.maxRatio).toBeLessThan(200_000);
  });

  it('throws too_large, naming the limit, rather than handing back a refusal', () => {
    const limits = { maxEntries: 2000, maxTotalBytes: 1000, maxRatio: 20, minAllowanceBytes: 0 };
    expect(() => addRound(miniCep(), new Date(), limits)).toThrow(/unzips to more than 1000 bytes/);
    expect(cepErrorCode(() => addRound(miniCep(), new Date(), limits))).toBe('too_large');
  });

  it('reports the keys of a refused survey', () => {
    const { info } = addRound(
      miniCep({ 'placemark.idm.xml': idmWith('<text id="2" name="id" key="true"/><text id="4" name="b" key="true"/>') }),
    );
    expect(info.keyCount).toBe(2);
    expect(addRound(Buffer.from('x')).info.keyCount).toBe(0);
  });
});
