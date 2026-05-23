// 品牌提取：取 products.name trim 后第一个空格前的子串并大写
// 不含空格 → 'OTHER'（见 design.md 3.3 节）

function extractBrand(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return 'OTHER';
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) return 'OTHER';
  return trimmed.slice(0, spaceIdx).toUpperCase();
}

module.exports = { extractBrand };
