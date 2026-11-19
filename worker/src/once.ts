// 表の作成を1回だけ（2026-11-19、#292）。
//
// Workers では、ある要求の中で作った promise を、別の要求の中で待つことはできない（handle_cross_request_promise_resolution）。
// 以前は「作成中の promise」を isolate 全体で共有していたため、冷えた起動のときに2つの要求が重なると、後の要求が
// 先の要求の promise を待ち、先の要求が終わった時点で "This promise was created by a request that has since ended,
// so it can never settle" で失敗していた（アカウントの処理の失敗が同じ瞬間に2件ずつ、の正体。2026-11-18 のログ）。
// そこで、共有するのは「済んだ」という印だけにする。済む前に重なった要求は、それぞれ自分で作る（CREATE … IF NOT EXISTS
// なので何回走っても同じ）。失敗したら印は付かず、次の要求でやり直す。
export function doneOnce(done: WeakSet<object>, key: object, make: () => Promise<void>): Promise<void> {
  if (done.has(key)) return Promise.resolve();
  return make().then(() => {
    done.add(key);
  });
}
