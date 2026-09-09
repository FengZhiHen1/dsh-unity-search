// 学术源桶（进 registry，可被 search_sources 直选与 fanout）。
// @ts-check

import { arxiv } from './arxiv.js'
import { openalex } from './openalex.js'
import { crossref } from './crossref.js'
import { pubmed } from './pubmed.js'
import { europepmc } from './europepmc.js'

/** @type {import('../types.js').SourceAdapter[]} */
export const academicSources = [arxiv, openalex, crossref, pubmed, europepmc]
