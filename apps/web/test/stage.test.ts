// #31: one full-screen set piece at a time. The Herald's auto-played lead, a live Clash or Introduction,
// a Hall replay and a pushed story all take turns on one stage, first come first served.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Stage } from '../src/stage.ts';

test('the first card to ask plays; the next waits for it to finish', () => {
  const stage = new Stage();
  stage.request('herald:40');
  stage.request('live:52');
  assert.equal(stage.current(), 'herald:40');
  stage.release('herald:40');
  assert.equal(stage.current(), 'live:52');
  stage.release('live:52');
  assert.equal(stage.current(), null);
});

test('a card that gives up its place while waiting never plays', () => {
  const stage = new Stage();
  stage.request('live:52');
  stage.request('herald:40');
  stage.release('herald:40'); // the Herald closed before its turn
  stage.release('live:52');
  assert.equal(stage.current(), null);
});

test('asking twice keeps one place in the queue', () => {
  const stage = new Stage();
  stage.request('a');
  stage.request('b');
  stage.request('a');
  stage.release('a');
  assert.equal(stage.current(), 'b');
});

test('listeners hear every change of who is on stage', () => {
  const stage = new Stage();
  const heard: (string | null)[] = [];
  const stop = stage.subscribe(() => heard.push(stage.current()));
  stage.request('a');
  stage.request('b');
  stage.release('a');
  stop();
  stage.release('b');
  assert.deepEqual(heard, ['a', 'a', 'b']);
});
