// The chassis models on the shared turntable. The caption carries the stats each
// one overrides, in the order the garage shows them.

import { CHASSIS, STAT_LABELS, buildChassis, statList } from './kart-chassis.js'
import { mountViewer } from './model-viewer.js'

const models = Object.fromEntries(
  Object.entries(CHASSIS).map(([key, entry]) => [
    key,
    {
      name: entry.name,
      sub: entry.note,
      note: statList(key)
        .map((v, i) => `${STAT_LABELS[i]} ${v}`)
        .join('  ·  '),
    },
  ]),
)

mountViewer({ models, build: buildChassis, slug: 'chassis', kind: 'kart chassis' })
