import { createEmptyLevel } from './presets';
import { LevelDocument } from './types';

/**
 * 补全外部来源（localStorage 旧存档 / 手改或 AI 直接写的 JSON / Bridge 推送）文档里缺失的字段，
 * 保证渲染与分析代码拿到的数组、配置对象一定存在。连 `blocks` 数组都没有时视为非法，返回 null。
 * 浏览器端与 Node 端（Bridge / CLI / MCP）共用。
 */
export function normalizeLevelDocument(raw: unknown): LevelDocument | null {
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw as Partial<LevelDocument>;
  if (!Array.isArray(doc.blocks)) return null;
  const defaults = createEmptyLevel();
  return {
    ...doc,
    version: doc.version || defaults.version,
    metadata: { ...defaults.metadata, ...(doc.metadata || {}) },
    metricsProfile: { ...defaults.metricsProfile, ...(doc.metricsProfile || {}) },
    sectionPlane: { ...defaults.sectionPlane, ...(doc.sectionPlane || {}) },
    blocks: doc.blocks,
    paths: Array.isArray(doc.paths) ? doc.paths : [],
    pois: Array.isArray(doc.pois) ? doc.pois : [],
    jumps: Array.isArray(doc.jumps) ? doc.jumps : [],
    sightlines: Array.isArray(doc.sightlines) ? doc.sightlines : [],
  } as LevelDocument;
}
