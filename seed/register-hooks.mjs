// resolve フックを登録する（`node --import ./seed/register-hooks.mjs seed/seed-vocab.mjs` で使う）。
// import は評価前にフックが要るため、メイン実行より前にこのファイルを --import で読み込む。
import { register } from 'node:module';
register('./resolve-extensionless.mjs', import.meta.url);
