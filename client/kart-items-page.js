// The item models on the shared turntable. The race is where they are used,
// this is where they are looked at.

import { ITEM_MODELS, buildItem } from './kart-items.js'
import { mountViewer } from './model-viewer.js'

const models = Object.fromEntries(
  Object.entries(ITEM_MODELS).map(([key, item]) => [key, { ...item, sub: key }]),
)

mountViewer({ models, build: buildItem, slug: 'kart', kind: 'kart items' })
