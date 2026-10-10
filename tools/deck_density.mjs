/* deck_density.mjs —— 【已废弃 2026-10-10, 保留以免有人重新造一把歪尺子】
 *
 * 这个工具当初量的东西不算错(字数/加粗/卡片/指标卡), 但**结论用错了**:
 * 它只输出"全篇均值"(参照稿 674 字/页 · 7 处加粗/页), 我拿这些均值去当**逐页硬顶**写进了
 * validateDeck, 结果三条判据把用户认可的参照稿本身判成不合格(详见 server/deckmetrics.mjs 顶部注释)。
 *
 * 现在的唯一口径是 server/deckmetrics.mjs(逐页度量 + 从参照稿实测值推出的门槛),
 * 看数用 tools/template_spec.mjs。这里保留一个转发, 免得旧习惯又把均值当上限。
 *
 * 用法: node tools/deck_density.mjs <deck.html> [...]   (= node tools/template_spec.mjs ...)
 */
console.warn('⚠ deck_density 已废弃: 口径统一在 server/deckmetrics.mjs, 本命令转发到 tools/template_spec.mjs');
if (process.argv.length < 3) process.argv.push('--ref');
await import('./template_spec.mjs');
