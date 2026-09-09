// 网页引擎桶：链顺序与设置键均按 id，数组序仅为注册便利。
// @ts-check

import { bing } from './bing.js'
import { ddg } from './ddg.js'
import { ddgLite } from './ddg-lite.js'
import { anysearch } from './anysearch.js'
import { searxng } from './searxng.js'
import { keenable } from './keenable.js'
import { deepseekOfficial } from './deepseek-official.js'
import { tavily } from './tavily.js'
import { exa } from './exa.js'
import { perplexity } from './perplexity.js'

/** @type {import('../types.js').SourceAdapter[]} */
export const webEngines = [bing, ddg, ddgLite, anysearch, searxng, keenable, deepseekOfficial, tavily, exa, perplexity]
