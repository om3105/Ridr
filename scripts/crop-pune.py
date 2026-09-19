"""Crop routing roads and their restrictions without losing referenced nodes.

Requires osmium==4.2.0. Input: Geofabrik Western Zone .osm.pbf.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
import osmium

source = Path(sys.argv[1])
output = Path(sys.argv[2])
bounds = (73.68, 18.38, 74.05, 18.70)

class PuneRoads(osmium.SimpleHandler):
    def __init__(self, writer):
        super().__init__()
        self.writer = writer
        self.nodes = set()
        self.ways = set()
        self.restrictions = 0

    def node(self, node):
        if node.location.valid() and bounds[0] <= node.lon <= bounds[2] and bounds[1] <= node.lat <= bounds[3]:
            self.nodes.add(node.id)

    def way(self, way):
        if 'highway' in way.tags and any(n.ref in self.nodes for n in way.nodes):
            self.ways.add(way.id)
            self.writer.add_way(way)

    def relation(self, relation):
        if relation.tags.get('type', '').startswith('restriction') and any(m.type == 'w' and m.ref in self.ways for m in relation.members):
            self.writer.add_relation(relation)
            self.restrictions += 1

output.parent.mkdir(parents=True, exist_ok=True)
with osmium.BackReferenceWriter(str(output), str(source), overwrite=True, remove_tags=False) as writer:
    roads = PuneRoads(writer)
    roads.apply_file(str(source))
    if not roads.ways:
        raise RuntimeError('The input contains no Pune roads.')
metadata = dict(source='Geofabrik Western Zone / OpenStreetMap contributors', fetchedAt=datetime.now(timezone.utc).isoformat(), bounds=bounds, roads=len(roads.ways), restrictions=roads.restrictions)
output.with_name('source.json').write_text(json.dumps(metadata, indent=2))
print(f'Pune extract: {len(roads.ways)} roads and {roads.restrictions} restrictions.', flush=True)
