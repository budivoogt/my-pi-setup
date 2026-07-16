import assert from "node:assert/strict";
import test from "node:test";
import { createDeferredResultDelivery } from "./src/result-delivery.ts";

test("a result consumed by a later wait is not delivered", () => {
  const delivery = createDeferredResultDelivery<{
    id: string;
    output: string;
  }>();

  delivery.defer({ id: "sa-1", output: "done" });
  delivery.consume([{ id: "sa-1" }]);

  assert.deepEqual(delivery.drain(), []);
});

test("unconsumed results are delivered once in settlement order", () => {
  const delivery = createDeferredResultDelivery<{ id: string }>();
  const first = { id: "sa-1" };
  const second = { id: "sa-2" };

  delivery.defer(first);
  delivery.defer(second);

  assert.deepEqual(delivery.drain(), [first, second]);
  assert.deepEqual(delivery.drain(), []);
});

test("multiple settled turns from one persistent child are retained", () => {
  const delivery = createDeferredResultDelivery<{
    id: string;
    runSequence: number;
    output: string;
  }>();
  delivery.defer({ id: "sa-1", runSequence: 1, output: "first" });
  delivery.defer({ id: "sa-1", runSequence: 2, output: "second" });
  assert.deepEqual(delivery.drain(), [
    { id: "sa-1", runSequence: 1, output: "first" },
    { id: "sa-1", runSequence: 2, output: "second" },
  ]);
});

test("waiting for a later turn does not consume an earlier queued turn", () => {
  const delivery = createDeferredResultDelivery<{
    id: string;
    runSequence: number;
    output: string;
  }>();
  const first = { id: "sa-1", runSequence: 1, output: "first" };
  const second = { id: "sa-1", runSequence: 2, output: "second" };
  delivery.defer(first);
  delivery.defer(second);
  delivery.consume([second]);
  assert.deepEqual(delivery.drain(), [first]);
});
