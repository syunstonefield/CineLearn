// 利用者・端末の識別子を、元に戻せない短い番号にする（集計・月の生成数のキー用）。
//   sha256(pepper + '\n' + 値) の先頭16hex。pepper は env（CL_HASH_PEPPER → 無ければ CL_SEED_SECRET）だけに置き、ログに出さない。
//   ★pepper を変えると番号が全部変わる（過去の集計と今月の生成数がつながらなくなる）＝変えない。
// seed（素の Node）からも import され得るため node:* 以外は使わない。
import { createHash } from 'node:crypto';

export function hashId(v, env = process.env) {
  return createHash('sha256')
    .update(`${env.CL_HASH_PEPPER || env.CL_SEED_SECRET || 'cl'}\n${v}`)
    .digest('hex')
    .slice(0, 16);
}
