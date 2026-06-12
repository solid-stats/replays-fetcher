/* eslint-disable */
const p: Promise<number> = Promise.resolve(1);
p; // no-floating-promises SHOULD fire

declare const anyVal: any;
const x = anyVal.foo; // no-unsafe-member-access SHOULD fire
const y: number = anyVal; // no-unsafe-assignment SHOULD fire

declare const s: string | undefined;
if (s) {} // strict-boolean-expressions(allowNullableString:true) -> ok; use number:
declare const n: number | undefined;
if (n) {} // strict-boolean-expressions SHOULD fire (allowNullableNumber:false)

function takesCb(cb: () => void) {}
takesCb(async () => { await p; }); // no-misused-promises (checksVoidReturn off in vc, so maybe not)

const bad = "a" + {}; // restrict-plus-operands SHOULD fire
