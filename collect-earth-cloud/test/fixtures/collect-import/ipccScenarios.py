"""How ipcc-scenarios.summaries.json was made (test/ipcc.test.ts compares src/ipcc.ts's yearly land uses with it).

Records of the survey of ../desktop-xml-export.zip, whose ipcc_<year>_* questions IPCCSurveyAdapter wrote, with land use
changes, and without their calculated questions, so that Collect works them out again:
  python ipccScenarios.py <unzipped export>/1/247102.xml <out>/1
  java ... SummaryDump <unzipped export>/idml.xml <out>/1/9001.xml ... <out>/1/9009.xml > ipcc-scenarios.summaries.json
(SummaryDump.java says how to build and run it; line ends made LF.) args: the base record, the folder to write to."""
import re
import sys

base = open(sys.argv[1], encoding='utf-8').read()
out = sys.argv[2]

CALCULATED = r'(ipcc_[a-z0-9_]+|land_use_category_has_changed|land_use_change_once|land_use_subdivision_combination|land_use_oldest_subdivision_combination|calculated_initial_land_use|land_use_category_alias|no_second_luchange)'
stripped = re.sub(r'\n\s*<' + CALCULATED + r'(?: [^>]*)?(?:/>|>.*?</\1>)', '', base, flags=re.S)

def code(v):
    return f'<code>{v}</code>' if v else None

def boolean(v):
    return f'<value>{v}</value>' if v else None

def setting(xml, name, inner):
    pattern = re.compile(r'<' + name + r'(?: [^>]*)?(?:/>|>.*?</' + name + r'>)', re.S)
    assert pattern.search(xml), name
    return pattern.sub(f'<{name}>{inner}</{name}>' if inner else f'<{name} />', xml, count=1)

# id, subcategory, change year, subdivision, subdivision changed, its year, initial subdivision, second change, oldest
# land use, its year, oldest subdivision
SCENARIOS = [
    ('9001', 'FC', '2010', 'annual_crops', '', '', 'broadleaf_dec', '', '', '', ''),
    ('9002', 'FC', '2002', 'rice', '', '', 'mangrove', '', '', '', ''),
    ('9003', 'GG', '', 'shrubland', 'true', '2015', 'grassland', '', '', '', ''),
    ('9004', 'GS', '2018', 'city', '', '', 'grassland', 'true', 'F', '2005', 'broadleaf_ever'),
    ('9005', 'CC', '', 'rice', 'true', '2016', 'annual_crops', 'true', 'F', '2008', 'coniferous_ever'),
    ('9006', 'FC', '2012', 'palm', 'true', '2018', 'broadleaf_mix', '', '', '', ''),
    ('9007', 'GS', '2020', 'village', '', '', 'grassland_trees', 'true', 'F', '2001', 'riparian'),
    ('9008', 'OW', '2004', 'swamp', 'false', '', 'barren_soil', 'false', '', '', ''),
    ('9009', 'SS', '', 'built_up', 'true', '2003', 'city', 'true', 'C', '2001', 'garden'),
]
for (key, sub, year, subdivision, changed, sub_year, initial, second, conv, conv_year, oldest) in SCENARIOS:
    xml = setting(stripped, 'id', f'<value>{key}</value>')
    xml = setting(xml, 'land_use_subcategory', code(sub))
    xml = setting(xml, 'land_use_subcategory_year_of_change', code(year))
    xml = setting(xml, 'land_use_subdivision', code(subdivision))
    xml = setting(xml, 'land_use_subdivision_change', boolean(changed))
    xml = setting(xml, 'land_use_subdivision_year_of_change', code(sub_year))
    xml = setting(xml, 'land_use_initial_subdivision', code(initial))
    xml = setting(xml, 'second_lu_change', boolean(second))
    xml = setting(xml, 'second_lu_conversion', code(conv))
    xml = setting(xml, 'second_lu_conversion_year', code(conv_year))
    xml = setting(xml, 'second_lu_subdivision', code(oldest))
    open(f'{out}/{key}.xml', 'w', encoding='utf-8', newline='\n').write(xml)
