// 拡張子なしの相対 import（Next バンドラ前提＝ next-app/lib/*.js が `from './api'` 等で書かれている）
// を、素の Node でも解決できるようにする resolve フック。
// 解決に失敗した相対 specifier に `.js` を補って再解決する。
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    const hasJsExt = /\.[mc]?js$/.test(specifier);
    if (relative && !hasJsExt && (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.code === 'ERR_UNSUPPORTED_DIR_IMPORT')) {
      return nextResolve(specifier + '.js', context);
    }
    throw err;
  }
}
