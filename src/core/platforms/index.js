// 平台源桶（进 registry，可被 search_sources 直选与 fanout）。
// @ts-check

import { github } from './github.js'
import { stackoverflow } from './stackoverflow.js'
import { hn } from './hn.js'
import { wikipedia } from './wikipedia.js'
import { npm } from './npm.js'
import { v2ex } from './v2ex.js'
import { bilibili } from './bilibili.js'
import { reddit } from './reddit.js'

/** @type {import('../types.js').SourceAdapter[]} */
export const platformSources = [github, stackoverflow, hn, wikipedia, npm, v2ex, bilibili, reddit]
