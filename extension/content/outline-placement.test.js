import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function loadPlacementHelper() {
  const source = await readFile(
    new URL('./outline-placement.js', import.meta.url),
    'utf8'
  );
  const context = {
    window: {},
    globalThis: {},
  };

  vm.createContext(context);
  vm.runInContext(source, context);

  return context.window.SpeakademicOutlinePlacement;
}

test('shouldPlaceOutlineLeft stays on the right when it fits', async () => {
  const helper = await loadPlacementHelper();

  assert.equal(
    helper.shouldPlaceOutlineLeft({
      panelLeft: 700,
      panelRight: 1030,
      outlineWidth: 224,
      viewportWidth: 1280,
    }),
    false
  );
});

test('shouldPlaceOutlineLeft flips left when the right side clips', async () => {
  const helper = await loadPlacementHelper();

  assert.equal(
    helper.shouldPlaceOutlineLeft({
      panelLeft: 920,
      panelRight: 1250,
      outlineWidth: 224,
      viewportWidth: 1280,
    }),
    true
  );
});

test('shouldPlaceOutlineLeft picks the side with less overflow', async () => {
  const helper = await loadPlacementHelper();

  assert.equal(
    helper.shouldPlaceOutlineLeft({
      panelLeft: 180,
      panelRight: 510,
      outlineWidth: 224,
      viewportWidth: 620,
    }),
    true
  );
});
